package blog.server;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Minimal JSON: a strict parser with depth and size limits, and a writer that escapes everything HTML might mind. */
final class Json {
  private Json() {}

  static final class Bad extends RuntimeException {
    private static final long serialVersionUID = 1L;

    Bad(String message) { super(message); }
  }

  private static final int MAX_DEPTH = 8;
  private static final java.util.regex.Pattern NUMBER = java.util.regex.Pattern.compile("-?(0|[1-9]\\d*)(\\.\\d+)?([eE][+-]?\\d+)?");

  static Object parse(String text) {
    return parse(text, 64, 1000);
  }

  /** For what only the signed-in owner sends, or the database gives back: an album can hold thousands of photos. */
  static Object parseLarge(String text) {
    return parse(text, 5000, 5000);
  }

  private static Object parse(String text, int maxKeys, int maxItems) {
    Json.Parser p = new Json.Parser(text, maxKeys, maxItems);
    p.space();
    Object v = p.value(0);
    p.space();
    if (p.at != text.length()) throw new Bad("trailing characters");
    return v;
  }

  private static final class Parser {
    private final String s;
    private final int maxKeys;
    private final int maxItems;
    private int at;

    Parser(String s, int maxKeys, int maxItems) {
      this.s = s;
      this.maxKeys = maxKeys;
      this.maxItems = maxItems;
    }

    void space() {
      while (at < s.length()) {
        char c = s.charAt(at);
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') at++; else break;
      }
    }

    Object value(int depth) {
      if (depth > MAX_DEPTH) throw new Bad("too deeply nested");
      if (at >= s.length()) throw new Bad("unexpected end");
      char c = s.charAt(at);
      switch (c) {
        case '{': return object(depth);
        case '[': return array(depth);
        case '"': return string();
        case 't': return word("true", Boolean.TRUE);
        case 'f': return word("false", Boolean.FALSE);
        case 'n': return word("null", null);
        default:
          if (c == '-' || (c >= '0' && c <= '9')) return number();
          throw new Bad("unexpected character");
      }
    }

    private Object word(String w, Object v) {
      if (!s.startsWith(w, at)) throw new Bad("unexpected word");
      at += w.length();
      return v;
    }

    private Map<String, Object> object(int depth) {
      Map<String, Object> m = new LinkedHashMap<>();
      at++;
      space();
      if (at < s.length() && s.charAt(at) == '}') { at++; return m; }
      while (true) {
        space();
        if (at >= s.length() || s.charAt(at) != '"') throw new Bad("expected a key");
        String k = string();
        space();
        expect(':');
        space();
        m.put(k, value(depth + 1));
        if (m.size() > maxKeys) throw new Bad("too many keys");
        space();
        if (at < s.length() && s.charAt(at) == ',') { at++; continue; }
        expect('}');
        return m;
      }
    }

    private List<Object> array(int depth) {
      List<Object> l = new ArrayList<>();
      at++;
      space();
      if (at < s.length() && s.charAt(at) == ']') { at++; return l; }
      while (true) {
        space();
        l.add(value(depth + 1));
        if (l.size() > maxItems) throw new Bad("array too long");
        space();
        if (at < s.length() && s.charAt(at) == ',') { at++; continue; }
        expect(']');
        return l;
      }
    }

    private void expect(char c) {
      if (at >= s.length() || s.charAt(at) != c) throw new Bad("expected '" + c + "'");
      at++;
    }

    private String string() {
      at++;
      StringBuilder b = new StringBuilder();
      while (true) {
        if (at >= s.length()) throw new Bad("unterminated string");
        char c = s.charAt(at++);
        if (c == '"') return b.toString();
        if (c < 0x20) throw new Bad("control character in string");
        if (c != '\\') { b.append(c); continue; }
        if (at >= s.length()) throw new Bad("bad escape");
        char e = s.charAt(at++);
        switch (e) {
          case '"', '\\', '/' -> b.append(e);
          case 'b' -> b.append('\b');
          case 'f' -> b.append('\f');
          case 'n' -> b.append('\n');
          case 'r' -> b.append('\r');
          case 't' -> b.append('\t');
          case 'u' -> {
            if (at + 4 > s.length()) throw new Bad("bad unicode escape");
            try {
              b.append((char) Integer.parseInt(s.substring(at, at + 4), 16));
            } catch (NumberFormatException x) {
              throw new Bad("bad unicode escape");
            }
            at += 4;
          }
          default -> throw new Bad("bad escape");
        }
      }
    }

    private Object number() {
      int start = at;
      if (s.charAt(at) == '-') at++;
      while (at < s.length() && "0123456789.eE+-".indexOf(s.charAt(at)) >= 0) at++;
      String n = s.substring(start, at);
      if (n.length() > 30) throw new Bad("number too long");
      if (!NUMBER.matcher(n).matches()) throw new Bad("bad number"); /* JSON's own grammar: no 01, no 1., no +1 */
      try {
        if (n.matches("-?\\d{1,18}")) return Long.parseLong(n);
        return Double.parseDouble(n);
      } catch (NumberFormatException x) {
        throw new Bad("bad number");
      }
    }
  }

  /* ---------------------------------------------------------------- writing */

  static String write(Object v) {
    StringBuilder b = new StringBuilder();
    write(b, v);
    return b.toString();
  }

  private static void write(StringBuilder b, Object v) {
    if (v == null) b.append("null");
    else if (v instanceof String str) quote(b, str);
    else if (v instanceof Boolean || v instanceof Integer || v instanceof Long) b.append(v);
    else if (v instanceof Number n) b.append(Double.isFinite(n.doubleValue()) ? n.toString() : "null");
    else if (v instanceof Map<?, ?> m) {
      b.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> e : m.entrySet()) {
        if (!first) b.append(',');
        first = false;
        quote(b, String.valueOf(e.getKey()));
        b.append(':');
        write(b, e.getValue());
      }
      b.append('}');
    } else if (v instanceof Collection<?> c) {
      b.append('[');
      boolean first = true;
      for (Object o : c) {
        if (!first) b.append(',');
        first = false;
        write(b, o);
      }
      b.append(']');
    } else quote(b, v.toString());
  }

  /** Indented, for files people also read and diff (content/site.json); only what JSON requires is escaped. */
  static String pretty(Object v) {
    StringBuilder b = new StringBuilder();
    pretty(b, v, "");
    return b.append('\n').toString();
  }

  private static void pretty(StringBuilder b, Object v, String indent) {
    String in = indent + "  ";
    if (v instanceof Map<?, ?> m && !m.isEmpty()) {
      b.append("{\n");
      int i = 0;
      for (Map.Entry<?, ?> e : m.entrySet()) {
        b.append(in);
        plain(b, String.valueOf(e.getKey()));
        b.append(": ");
        pretty(b, e.getValue(), in);
        b.append(++i < m.size() ? ",\n" : "\n");
      }
      b.append(indent).append('}');
    } else if (v instanceof Collection<?> c && !c.isEmpty()) {
      boolean flat = c.stream().allMatch(o -> o == null || o instanceof String || o instanceof Number || o instanceof Boolean) && c.size() <= 4;
      if (flat) {
        b.append('[');
        int i = 0;
        for (Object o : c) {
          pretty(b, o, in);
          if (++i < c.size()) b.append(", ");
        }
        b.append(']');
        return;
      }
      b.append("[\n");
      int i = 0;
      for (Object o : c) {
        b.append(in);
        pretty(b, o, in);
        b.append(++i < c.size() ? ",\n" : "\n");
      }
      b.append(indent).append(']');
    } else if (v instanceof String s) {
      plain(b, s);
    } else {
      write(b, v);
    }
  }

  private static void plain(StringBuilder b, String s) {
    b.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"' -> b.append("\\\"");
        case '\\' -> b.append("\\\\");
        case '\n' -> b.append("\\n");
        case '\r' -> b.append("\\r");
        case '\t' -> b.append("\\t");
        default -> {
          if (c < 0x20 || c == '\u2028' || c == '\u2029') b.append(String.format("\\u%04x", (int) c));
          else b.append(c);
        }
      }
    }
    b.append('"');
  }

  /** Escapes quotes and control characters, and also < > & ' and the line separators, so the output is safe anywhere. */
  private static void quote(StringBuilder b, String s) {
    b.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"' -> b.append("\\\"");
        case '\\' -> b.append("\\\\");
        case '\n' -> b.append("\\n");
        case '\r' -> b.append("\\r");
        case '\t' -> b.append("\\t");
        default -> {
          if (c < 0x20 || c == '<' || c == '>' || c == '&' || c == '\'' || c == ' ' || c == ' ') {
            b.append(String.format("\\u%04x", (int) c));
          } else b.append(c);
        }
      }
    }
    b.append('"');
  }
}
