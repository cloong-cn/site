package blog.server;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Saving and publishing take a few seconds (the site is rebuilt), so they run one at a time in the background; the
 * admin page polls GET /api/admin/jobs/{id} for the outcome and the log.
 */
final class Jobs {
  interface Work {
    void run(Job job) throws Exception;
  }

  static final class Job {
    final String id = Guard.randomToken(12);
    final String label;
    final long created = System.currentTimeMillis();
    volatile String state = "queued";
    volatile String error;
    volatile String code;
    volatile long ended;
    final Map<String, Object> result = new ConcurrentHashMap<>();
    private final StringBuilder log = new StringBuilder();

    Job(String label) { this.label = label; }

    void say(String line) {
      synchronized (log) {
        if (log.length() < 200_000) log.append(line).append('\n');
      }
    }

    Map<String, Object> view() {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", id);
      m.put("label", label);
      m.put("state", state);
      m.put("error", error);
      m.put("code", code);
      m.put("created", created);
      m.put("ended", ended == 0 ? null : ended);
      synchronized (log) {
        m.put("log", log.toString());
      }
      m.put("result", Map.copyOf(result));
      return m;
    }
  }

  private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
    Thread t = new Thread(r, "jobs");
    t.setDaemon(true);
    return t;
  });
  private final Map<String, Job> byId = new ConcurrentHashMap<>();
  private final Deque<String> order = new ArrayDeque<>();

  Job submit(String label, Work work) {
    Job job = new Job(label);
    synchronized (order) {
      byId.put(job.id, job);
      order.addLast(job.id);
      while (order.size() > 50) byId.remove(order.removeFirst());
    }
    worker.submit(() -> {
      job.state = "running";
      try {
        work.run(job);
        job.state = "done";
      } catch (Http.Fail f) {
        job.error = f.getMessage();
        job.code = f.code;
        job.state = "failed";
      } catch (Throwable t) {
        Log.warn("job %s failed: %s", label, t);
        job.error = "出了点问题：" + t.getClass().getSimpleName();
        job.code = "server";
        job.state = "failed";
      } finally {
        job.ended = System.currentTimeMillis();
        Log.info("job %s: %s%s", label, job.state, job.error == null ? "" : " (" + job.error + ")");
      }
    });
    return job;
  }

  Job get(String id) {
    return id == null ? null : byId.get(id);
  }

  void close() {
    worker.shutdownNow();
  }
}
