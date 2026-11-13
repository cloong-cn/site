package blog.server;

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

/** One line per event on standard output; under systemd it ends up in the journal (journalctl -u blog-comments). */
final class Log {
  private Log() {}

  private static final PrintStream OUT = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);

  static void info(String format, Object... args) {
    OUT.println("INFO  " + String.format(format, args));
  }

  static void warn(String format, Object... args) {
    OUT.println("WARN  " + String.format(format, args));
  }
}
