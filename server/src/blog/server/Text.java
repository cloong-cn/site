package blog.server;

import java.util.regex.Pattern;

/** Cleaning text that people typed. */
final class Text {
  private Text() {}

  /* characters that can disguise text: bidirectional overrides and isolates */
  private static final Pattern BIDI = Pattern.compile("[\\u202A-\\u202E\\u2066-\\u2069\\u200E\\u200F]");

  /** One line of text: no control characters, no direction overrides, spaces collapsed; max in code points. */
  static String line(String s, int max) {
    String t = BIDI.matcher(s).replaceAll("").replaceAll("[\\p{Cntrl}\\s]+", " ").strip();
    if (t.codePointCount(0, t.length()) > max) throw new Http.Fail(400, "too_long", "内容太长了（最多 " + max + " 个字）");
    return t;
  }

  /** A block of text: line breaks kept (at most one blank line in a row), other control characters removed. */
  static String block(String s, int max) {
    String t = BIDI.matcher(s.replace("\r\n", "\n").replace('\r', '\n').replace('\t', ' ')).replaceAll("");
    t = t.replaceAll("[\\p{Cntrl}&&[^\\n]]", "").replaceAll("[ \\u00A0]+\\n", "\n").replaceAll("\\n{3,}", "\n\n").strip();
    if (t.codePointCount(0, t.length()) > max) throw new Http.Fail(400, "too_long", "内容太长了（最多 " + max + " 个字）");
    return t;
  }

  /** Like line(), but cut to max code points instead of refusing (for headers nobody types). */
  static String clip(String s, int max) {
    if (s == null) return null;
    String t = BIDI.matcher(s).replaceAll("").replaceAll("[\\p{Cntrl}\\s]+", " ").strip();
    if (t.codePointCount(0, t.length()) > max) t = t.substring(0, t.offsetByCodePoints(0, max));
    return t.isEmpty() ? null : t;
  }
}
