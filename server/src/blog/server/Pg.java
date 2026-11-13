package blog.server;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

/**
 * A small PostgreSQL client that speaks the wire protocol (version 3) directly, so the service needs no driver.
 * It does only what this service uses: password login (SCRAM-SHA-256 or MD5), one statement at a time through the
 * extended query protocol, results as text. Every value is sent as a bound parameter, separate from the SQL text,
 * so nothing a visitor types can change a query.
 */
final class Pg {
  private Pg() {}

  /** An error reported by the server (SQLSTATE in {@link #state}); the connection is still usable afterwards. */
  static final class PgError extends RuntimeException {
    private static final long serialVersionUID = 1L;
    final String state;

    PgError(String state, String message) {
      super(state + ": " + message);
      this.state = state;
    }
  }

  /** The database could not be reached, or the pool is exhausted: the caller answers 503. */
  static final class Unavailable extends RuntimeException {
    private static final long serialVersionUID = 1L;

    Unavailable(String message, Throwable cause) { super(message, cause); }
  }

  /** Query result: column names and rows of text values (null for SQL NULL). */
  static final class Rows {
    final List<String> columns;
    final List<String[]> data;
    final String tag;

    Rows(List<String> columns, List<String[]> data, String tag) {
      this.columns = columns;
      this.data = data;
      this.tag = tag;
    }

    int size() { return data.size(); }

    String get(int row, String column) {
      int i = columns.indexOf(column);
      if (i < 0) throw new IllegalArgumentException("no column " + column);
      return data.get(row)[i];
    }

    List<Map<String, String>> maps() {
      List<Map<String, String>> out = new ArrayList<>();
      for (String[] r : data) {
        Map<String, String> m = new HashMap<>();
        for (int i = 0; i < columns.size(); i++) m.put(columns.get(i), r[i]);
        out.add(m);
      }
      return out;
    }
  }

  record Settings(String host, int port, String database, String user, String password) {}

  /* ------------------------------------------------------------------ connection */

  static final class Conn implements Closeable {
    private final Socket socket;
    private final DataInputStream in;
    private final DataOutputStream out;
    private boolean broken;
    private long lastUsed = System.currentTimeMillis();

    Conn(Settings s) throws IOException {
      socket = new Socket();
      try {
        socket.connect(new InetSocketAddress(s.host(), s.port()), 3000);
        socket.setSoTimeout(15_000);
        socket.setTcpNoDelay(true);
        in = new DataInputStream(new BufferedInputStream(socket.getInputStream()));
        out = new DataOutputStream(new BufferedOutputStream(socket.getOutputStream()));
        startup(s);
      } catch (IOException | RuntimeException e) {
        socket.close();
        throw e;
      }
    }

    private void startup(Settings s) throws IOException {
      ByteArrayOutputStream b = new ByteArrayOutputStream();
      DataOutputStream d = new DataOutputStream(b);
      d.writeInt(196608); /* protocol 3.0 */
      for (String[] kv : new String[][] {
          {"user", s.user()}, {"database", s.database()}, {"application_name", "blog"}, {"client_encoding", "UTF8"}}) {
        cstr(d, kv[0]);
        cstr(d, kv[1]);
      }
      d.writeByte(0);
      out.writeInt(b.size() + 4);
      out.write(b.toByteArray());
      out.flush();

      Scram scram = null;
      while (true) {
        Msg m = read();
        switch (m.type) {
          case 'R' -> {
            int code = m.int32(0);
            switch (code) {
              case 0 -> { /* authenticated */ }
              case 3 -> send('p', cstrBytes(s.password()));
              case 5 -> send('p', cstrBytes(md5Password(s.user(), s.password(), m.slice(4, 8))));
              case 10 -> {
                if (!new String(m.body, 4, m.body.length - 4, StandardCharsets.UTF_8).contains("SCRAM-SHA-256")) {
                  throw new IOException("server offers no supported SASL mechanism");
                }
                scram = new Scram(s.password());
                byte[] first = scram.clientFirst().getBytes(StandardCharsets.UTF_8);
                ByteArrayOutputStream p = new ByteArrayOutputStream();
                DataOutputStream pd = new DataOutputStream(p);
                cstr(pd, "SCRAM-SHA-256");
                pd.writeInt(first.length);
                pd.write(first);
                send('p', p.toByteArray());
              }
              case 11 -> {
                if (scram == null) throw new IOException("unexpected SASL continue");
                String reply = scram.clientFinal(new String(m.body, 4, m.body.length - 4, StandardCharsets.UTF_8));
                send('p', reply.getBytes(StandardCharsets.UTF_8));
              }
              case 12 -> {
                if (scram == null || !scram.verifyServer(new String(m.body, 4, m.body.length - 4, StandardCharsets.UTF_8))) {
                  throw new IOException("server signature mismatch");
                }
              }
              default -> throw new IOException("unsupported authentication method " + code);
            }
          }
          case 'E' -> throw error(m);
          case 'Z' -> { return; } /* ready for query */
          default -> { /* parameter status, backend key data, notices */ }
        }
      }
    }

    /** Runs one statement. $1, $2 … in the SQL take the params in order (null, String, Number, Boolean). */
    Rows query(String sql, Object... params) {
      if (broken) throw new IllegalStateException("connection is broken");
      try {
        ByteArrayOutputStream all = new ByteArrayOutputStream();
        /* Parse: unnamed statement, let the server infer parameter types */
        ByteArrayOutputStream p = new ByteArrayOutputStream();
        DataOutputStream pd = new DataOutputStream(p);
        cstr(pd, "");
        cstr(pd, sql);
        pd.writeShort(0);
        frame(all, 'P', p.toByteArray());
        /* Bind: all parameters and results as text */
        ByteArrayOutputStream bnd = new ByteArrayOutputStream();
        DataOutputStream bd = new DataOutputStream(bnd);
        cstr(bd, "");
        cstr(bd, "");
        bd.writeShort(0);
        bd.writeShort(params.length);
        for (Object v : params) {
          if (v == null) {
            bd.writeInt(-1);
          } else {
            byte[] bytes = (v instanceof Boolean bo ? (bo ? "t" : "f") : v.toString()).getBytes(StandardCharsets.UTF_8);
            bd.writeInt(bytes.length);
            bd.write(bytes);
          }
        }
        bd.writeShort(0);
        frame(all, 'B', bnd.toByteArray());
        frame(all, 'D', new byte[] {'P', 0});
        frame(all, 'E', new byte[] {0, 0, 0, 0, 0});
        frame(all, 'S', new byte[0]);
        out.write(all.toByteArray());
        out.flush();

        List<String> cols = List.of();
        List<String[]> rows = new ArrayList<>();
        String tag = "";
        PgError err = null;
        while (true) {
          Msg m = read();
          switch (m.type) {
            case 'T' -> cols = rowDescription(m);
            case 'D' -> rows.add(dataRow(m));
            case 'C' -> tag = new String(m.body, 0, Math.max(0, m.body.length - 1), StandardCharsets.UTF_8);
            case 'E' -> err = error(m);
            case 'Z' -> {
              lastUsed = System.currentTimeMillis();
              if (err != null) throw err;
              return new Rows(cols, rows, tag);
            }
            default -> { /* parse/bind complete, no data, notices */ }
          }
        }
      } catch (IOException e) {
        broken = true;
        throw new Unavailable("database connection failed", e);
      }
    }

    long idleMs() { return System.currentTimeMillis() - lastUsed; }

    boolean broken() { return broken; }

    @Override
    public void close() {
      try {
        if (!broken) {
          out.write(new byte[] {'X', 0, 0, 0, 4});
          out.flush();
        }
      } catch (IOException ignored) {
        /* closing anyway */
      }
      try { socket.close(); } catch (IOException ignored) { /* nothing to do */ }
    }

    /* ---- wire format */

    private record Msg(char type, byte[] body) {
      int int32(int at) {
        return ((body[at] & 0xff) << 24) | ((body[at + 1] & 0xff) << 16) | ((body[at + 2] & 0xff) << 8) | (body[at + 3] & 0xff);
      }

      byte[] slice(int from, int to) {
        byte[] r = new byte[to - from];
        System.arraycopy(body, from, r, 0, r.length);
        return r;
      }
    }

    private Msg read() throws IOException {
      int type = in.read();
      if (type < 0) throw new EOFException("server closed the connection");
      int len = in.readInt();
      if (len < 4 || len > 64 * 1024 * 1024) throw new IOException("bad message length " + len);
      byte[] body = new byte[len - 4];
      in.readFully(body);
      return new Msg((char) type, body);
    }

    private void send(char type, byte[] body) throws IOException {
      ByteArrayOutputStream b = new ByteArrayOutputStream();
      frame(b, type, body);
      out.write(b.toByteArray());
      out.flush();
    }

    private static void frame(ByteArrayOutputStream to, char type, byte[] body) throws IOException {
      DataOutputStream d = new DataOutputStream(to);
      d.writeByte(type);
      d.writeInt(body.length + 4);
      d.write(body);
    }

    private static void cstr(DataOutputStream d, String s) throws IOException {
      d.write(s.getBytes(StandardCharsets.UTF_8));
      d.writeByte(0);
    }

    private static byte[] cstrBytes(String s) {
      byte[] b = s.getBytes(StandardCharsets.UTF_8);
      byte[] r = new byte[b.length + 1];
      System.arraycopy(b, 0, r, 0, b.length);
      return r;
    }

    private static List<String> rowDescription(Msg m) {
      int n = ((m.body[0] & 0xff) << 8) | (m.body[1] & 0xff);
      List<String> cols = new ArrayList<>(n);
      int at = 2;
      for (int i = 0; i < n; i++) {
        int end = at;
        while (m.body[end] != 0) end++;
        cols.add(new String(m.body, at, end - at, StandardCharsets.UTF_8));
        at = end + 1 + 18; /* table oid, column, type oid, size, modifier, format */
      }
      return cols;
    }

    private static String[] dataRow(Msg m) {
      int n = ((m.body[0] & 0xff) << 8) | (m.body[1] & 0xff);
      String[] row = new String[n];
      int at = 2;
      for (int i = 0; i < n; i++) {
        int len = m.int32(at);
        at += 4;
        if (len >= 0) {
          row[i] = new String(m.body, at, len, StandardCharsets.UTF_8);
          at += len;
        }
      }
      return row;
    }

    private static PgError error(Msg m) {
      String code = "?", message = "";
      int at = 0;
      while (at < m.body.length && m.body[at] != 0) {
        char field = (char) m.body[at++];
        int end = at;
        while (end < m.body.length && m.body[end] != 0) end++;
        String v = new String(m.body, at, end - at, StandardCharsets.UTF_8);
        if (field == 'C') code = v;
        if (field == 'M') message = v;
        at = end + 1;
      }
      return new PgError(code, message);
    }

    private static String md5Password(String user, String password, byte[] salt) {
      try {
        MessageDigest md = MessageDigest.getInstance("MD5");
        String inner = HexFormat.of().formatHex(md.digest((password + user).getBytes(StandardCharsets.UTF_8)));
        md.update(inner.getBytes(StandardCharsets.UTF_8));
        md.update(salt);
        return "md5" + HexFormat.of().formatHex(md.digest());
      } catch (Exception e) {
        throw new IllegalStateException(e);
      }
    }
  }

  /* ------------------------------------------------------------------ SCRAM-SHA-256 (RFC 5802 / 7677) */

  private static final class Scram {
    private final byte[] password;
    private final String clientNonce = Guard.randomToken(18);
    private String clientFirstBare;
    private byte[] saltedPassword;
    private String authMessage;

    Scram(String password) { this.password = password.getBytes(StandardCharsets.UTF_8); }

    String clientFirst() {
      clientFirstBare = "n=,r=" + clientNonce;
      return "n,," + clientFirstBare;
    }

    String clientFinal(String serverFirst) throws IOException {
      Map<String, String> f = fields(serverFirst);
      String nonce = f.get("r"), salt = f.get("s"), iter = f.get("i");
      if (nonce == null || salt == null || iter == null || !nonce.startsWith(clientNonce)) throw new IOException("bad SCRAM challenge");
      int rounds = Integer.parseInt(iter);
      if (rounds < 1000 || rounds > 1_000_000) throw new IOException("unreasonable SCRAM iteration count");
      saltedPassword = Guard.pbkdf2(password, Base64.getDecoder().decode(salt), rounds);
      String withoutProof = "c=biws,r=" + nonce;
      authMessage = clientFirstBare + "," + serverFirst + "," + withoutProof;
      byte[] clientKey = Guard.hmac(saltedPassword, "Client Key".getBytes(StandardCharsets.UTF_8));
      byte[] signature = Guard.hmac(Guard.sha256(clientKey), authMessage.getBytes(StandardCharsets.UTF_8));
      byte[] proof = new byte[clientKey.length];
      for (int i = 0; i < proof.length; i++) proof[i] = (byte) (clientKey[i] ^ signature[i]);
      return withoutProof + ",p=" + Base64.getEncoder().encodeToString(proof);
    }

    boolean verifyServer(String serverFinal) {
      String v = fields(serverFinal).get("v");
      if (v == null || saltedPassword == null) return false;
      byte[] serverKey = Guard.hmac(saltedPassword, "Server Key".getBytes(StandardCharsets.UTF_8));
      byte[] expected = Guard.hmac(serverKey, authMessage.getBytes(StandardCharsets.UTF_8));
      return MessageDigest.isEqual(expected, Base64.getDecoder().decode(v));
    }

    private static Map<String, String> fields(String s) {
      Map<String, String> m = new HashMap<>();
      for (String part : s.split(",")) {
        int eq = part.indexOf('=');
        if (eq == 1) m.put(part.substring(0, 1), part.substring(2));
      }
      return m;
    }
  }

  /* ------------------------------------------------------------------ pool */

  /** A handful of reusable connections. When all are busy for more than two seconds, callers get Unavailable. */
  static final class Pool {
    private final Settings settings;
    private final BlockingQueue<Conn> idle;
    private final Semaphore permits;

    Pool(Settings settings, int size) {
      this.settings = settings;
      this.idle = new ArrayBlockingQueue<>(size);
      this.permits = new Semaphore(size, true);
    }

    <T> T with(Function<Conn, T> work) {
      try {
        if (!permits.tryAcquire(2, TimeUnit.SECONDS)) throw new Unavailable("database busy", null);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new Unavailable("interrupted", e);
      }
      try {
        Conn c = idle.poll();
        if (c != null && c.idleMs() > 300_000) { /* long-idle connections may have been dropped along the way */
          c.close();
          c = null;
        }
        if (c != null) {
          try {
            return runOn(c, work);
          } catch (Unavailable e) {
            /* a pooled connection had died (database restarted, network blip): one attempt on a fresh one */
          }
        }
        return runOn(open(), work);
      } finally {
        permits.release();
      }
    }

    /** Like with(), inside BEGIN … COMMIT: everything the work does happens, or none of it (any exception rolls back). */
    <T> T tx(Function<Conn, T> work) {
      return with(c -> {
        c.query("BEGIN");
        try {
          T result = work.apply(c);
          c.query("COMMIT");
          return result;
        } catch (RuntimeException e) {
          if (!c.broken()) {
            try {
              c.query("ROLLBACK");
            } catch (RuntimeException ignored) {
              /* the connection is gone; it will not be reused */
            }
          }
          throw e;
        }
      });
    }

    /** Runs the work, then returns the connection to the pool, or closes it if it broke. */
    private <T> T runOn(Conn c, Function<Conn, T> work) {
      try {
        T result = work.apply(c);
        idle.offer(c);
        return result;
      } catch (RuntimeException e) {
        if (c.broken()) c.close(); else idle.offer(c);
        throw e;
      }
    }

    private Conn open() {
      try {
        return new Conn(settings);
      } catch (IOException e) {
        throw new Unavailable("cannot connect to the database: " + e.getMessage(), e);
      } catch (PgError e) {
        throw new Unavailable("database refused the connection: " + e.getMessage(), e);
      }
    }

    void close() {
      Conn c;
      while ((c = idle.poll()) != null) c.close();
    }
  }
}
