package blog.server;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.Base64;
import java.util.Deque;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Security helpers: password hashing, tokens, IP digests, rate limits and admin sessions. */
final class Guard {
  private Guard() {}

  static final SecureRandom RANDOM = new SecureRandom();
  private static final int PBKDF2_ROUNDS = 310_000;

  /* ---------------------------------------------------------------- hashing */

  static byte[] hmac(byte[] key, byte[] data) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      return mac.doFinal(data);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static byte[] sha256(byte[] data) {
    try {
      return MessageDigest.getInstance("SHA-256").digest(data);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  /** PBKDF2 with HMAC-SHA-256 (RFC 8018), 32-byte output. */
  static byte[] pbkdf2(byte[] password, byte[] salt, int rounds) {
    if (password.length == 0) throw new IllegalArgumentException("empty password");
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(password, "HmacSHA256"));
      mac.update(salt);
      mac.update(new byte[] {0, 0, 0, 1});
      byte[] u = mac.doFinal();
      byte[] out = u.clone();
      for (int i = 1; i < rounds; i++) {
        u = mac.doFinal(u);
        for (int j = 0; j < out.length; j++) out[j] ^= u[j];
      }
      return out;
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  /** "pbkdf2-sha256$rounds$salt$hash", the form admin.passwordHash takes. */
  static String hashPassword(char[] password) {
    byte[] salt = new byte[16];
    RANDOM.nextBytes(salt);
    byte[] pw = new String(password).getBytes(StandardCharsets.UTF_8);
    byte[] hash = pbkdf2(pw, salt, PBKDF2_ROUNDS);
    Base64.Encoder b64 = Base64.getEncoder().withoutPadding();
    return "pbkdf2-sha256$" + PBKDF2_ROUNDS + "$" + b64.encodeToString(salt) + "$" + b64.encodeToString(hash);
  }

  static boolean verifyPassword(String stored, String password) {
    if (stored == null || password == null) return false;
    String[] p = stored.split("\\$");
    if (p.length != 4 || !p[0].equals("pbkdf2-sha256")) return false;
    try {
      int rounds = Integer.parseInt(p[1]);
      if (rounds < 10_000 || rounds > 10_000_000) return false;
      byte[] salt = Base64.getDecoder().decode(p[2]);
      byte[] want = Base64.getDecoder().decode(p[3]);
      byte[] got = pbkdf2(password.getBytes(StandardCharsets.UTF_8), salt, rounds);
      return MessageDigest.isEqual(want, got); /* constant time */
    } catch (IllegalArgumentException e) {
      return false;
    }
  }

  static String randomToken(int bytes) {
    byte[] b = new byte[bytes];
    RANDOM.nextBytes(b);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
  }

  /** A visitor's IP is never stored as such: only this salted digest, enough to rate-limit and spot repeat spam. */
  static String ipHash(String salt, String ip) {
    byte[] d = hmac(salt.getBytes(StandardCharsets.UTF_8), String.valueOf(ip).getBytes(StandardCharsets.UTF_8));
    return HexFormat.of().formatHex(d, 0, 12);
  }

  /* ---------------------------------------------------------------- rate limits */

  /** Sliding-window counters kept in memory, per key (for example "post:" + ip digest). */
  static final class Limiter {
    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();
    private long lastPrune = System.currentTimeMillis();

    /** Records an attempt; false when there were already max attempts within the window. */
    boolean allow(String key, int max, long windowMs) {
      long now = System.currentTimeMillis();
      prune(now);
      Deque<Long> q = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
      synchronized (q) {
        while (!q.isEmpty() && now - q.peekFirst() > windowMs) q.pollFirst();
        if (q.size() >= max) return false;
        q.addLast(now);
        return true;
      }
    }

    /** Counts recent attempts without recording a new one. */
    int count(String key, long windowMs) {
      Deque<Long> q = hits.get(key);
      if (q == null) return 0;
      long now = System.currentTimeMillis();
      synchronized (q) {
        while (!q.isEmpty() && now - q.peekFirst() > windowMs) q.pollFirst();
        return q.size();
      }
    }

    void record(String key) {
      Deque<Long> q = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
      synchronized (q) { q.addLast(System.currentTimeMillis()); }
    }

    private void prune(long now) {
      if (now - lastPrune < 60_000) return;
      lastPrune = now;
      hits.entrySet().removeIf(e -> {
        synchronized (e.getValue()) {
          return e.getValue().isEmpty() || now - e.getValue().peekLast() > 86_400_000L;
        }
      });
    }
  }

  /* ---------------------------------------------------------------- admin sessions */

  /** Random session tokens kept in memory (a restart signs the admin out). Only a digest of each token is kept. */
  static final class Sessions {
    private final Map<String, Long> live = new ConcurrentHashMap<>();
    private final long ttlMs;

    Sessions(long ttlMs) { this.ttlMs = ttlMs; }

    String create() {
      String token = randomToken(32);
      long now = System.currentTimeMillis();
      live.entrySet().removeIf(e -> e.getValue() < now);
      live.put(key(token), now + ttlMs);
      return token;
    }

    boolean valid(String token) {
      if (token == null || token.length() < 20 || token.length() > 100) return false;
      Long until = live.get(key(token));
      return until != null && until > System.currentTimeMillis();
    }

    void drop(String token) {
      if (token != null) live.remove(key(token));
    }

    private static String key(String token) {
      return HexFormat.of().formatHex(sha256(token.getBytes(StandardCharsets.UTF_8)));
    }
  }
}
