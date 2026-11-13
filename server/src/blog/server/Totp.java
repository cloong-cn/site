package blog.server;

import java.nio.ByteBuffer;
import java.security.MessageDigest;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Time-based one-time codes (RFC 6238): the six digits an authenticator app on your phone shows, new every 30 seconds.
 * Works with Google Authenticator, Microsoft Authenticator, 1Password, the iPhone's Passwords app and so on.
 */
final class Totp {
  private Totp() {}

  private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  private static final int STEP = 30;

  /** A new random secret, 160 bits, in the base32 form authenticator apps take. */
  static String newSecret() {
    byte[] b = new byte[20];
    Guard.RANDOM.nextBytes(b);
    return encode(b);
  }

  static String encode(byte[] data) {
    StringBuilder out = new StringBuilder();
    int buffer = 0, bits = 0;
    for (byte d : data) {
      buffer = (buffer << 8) | (d & 0xff);
      bits += 8;
      while (bits >= 5) {
        out.append(ALPHABET.charAt((buffer >> (bits - 5)) & 31));
        bits -= 5;
      }
    }
    if (bits > 0) out.append(ALPHABET.charAt((buffer << (5 - bits)) & 31));
    return out.toString();
  }

  /** null when the text is not base32. */
  static byte[] decode(String s) {
    if (s == null || s.isEmpty()) return null;
    ByteBuffer out = ByteBuffer.allocate(s.length() * 5 / 8 + 1);
    int buffer = 0, bits = 0;
    for (char c : s.toCharArray()) {
      int v = ALPHABET.indexOf(c);
      if (v < 0) return null;
      buffer = (buffer << 5) | v;
      bits += 5;
      if (bits >= 8) {
        out.put((byte) (buffer >> (bits - 8)));
        bits -= 8;
      }
    }
    byte[] r = new byte[out.position()];
    out.flip().get(r);
    return r;
  }

  static String code(byte[] key, long step) {
    try {
      Mac mac = Mac.getInstance("HmacSHA1");
      mac.init(new SecretKeySpec(key, "HmacSHA1"));
      byte[] h = mac.doFinal(ByteBuffer.allocate(8).putLong(step).array());
      int o = h[h.length - 1] & 0xf;
      int n = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
      return String.format("%06d", n % 1_000_000);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static long stepAt(long millis) {
    return Math.floorDiv(millis / 1000, STEP);
  }

  /**
   * The time step the code belongs to (allowing the phone's clock to be 30 s off either way), or -1 when it does not
   * match. Comparisons take the same time whether or not digits match.
   */
  static long check(String secret, String code, long millis) {
    byte[] key = decode(secret);
    if (key == null || code == null || !code.matches("\\d{6}")) return -1;
    long now = stepAt(millis), found = -1;
    for (long s = now - 1; s <= now + 1; s++) {
      if (MessageDigest.isEqual(code(key, s).getBytes(), code.getBytes())) found = s;
    }
    return found;
  }

  /** otpauth:// address for the app; most apps also accept just the secret typed in. */
  static String uri(String secret, String account) {
    String label = "Blog:" + account.replaceAll("[^\\p{L}\\p{N}._-]", "");
    return "otpauth://totp/" + java.net.URLEncoder.encode(label, java.nio.charset.StandardCharsets.UTF_8).replace("+", "%20")
        + "?secret=" + secret + "&issuer=Blog&algorithm=SHA1&digits=6&period=30";
  }
}
