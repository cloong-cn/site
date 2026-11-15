package blog.server;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * content/site.json, the home page's words: name, introduction, links, projects, services, about. Everything the
 * admin page sends is checked against this shape; addresses must be http(s) (or mailto: for links), so nothing typed
 * here can turn into a script on the home page.
 */
final class SiteData {
  private SiteData() {}

  static final String PATH = "content/site.json";
  private static final Pattern WEB = Pattern.compile("https?://[^\\s<>\"']{1,300}");
  private static final Pattern MAIL = Pattern.compile("mailto:[^\\s<>\"'@]{1,64}@[^\\s<>\"'@]{1,190}");

  static Map<String, Object> check(Object input) {
    Map<String, Object> in = obj(input, "", Set.of("name", "brand", "role", "title", "description", "hero", "links", "blog", "work", "listening", "lab", "about"));
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("name", text(in, "name", 40, true));
    out.put("brand", text(in, "brand", 40, true));
    out.put("role", text(in, "role", 60, false));
    out.put("title", text(in, "title", 80, true));
    out.put("description", text(in, "description", 200, false));

    Map<String, Object> hero = obj(in.get("hero"), "hero", Set.of("intro", "now"));
    out.put("hero", ordered("intro", text(hero, "intro", 300, false), "now", text(hero, "now", 100, false)));

    List<Object> links = new ArrayList<>();
    for (Object o : list(in.get("links"), "links", 8)) {
      Map<String, Object> l = obj(o, "links", Set.of("label", "href"));
      String href = text(l, "href", 300, true);
      if (!WEB.matcher(href).matches() && !MAIL.matcher(href).matches()) throw bad("链接地址要以 https:// 或 mailto: 开头：" + href);
      links.add(ordered("label", text(l, "label", 20, true), "href", href));
    }
    out.put("links", links);

    Map<String, Object> blog = obj(in.get("blog"), "blog", Set.of("lead"));
    out.put("blog", ordered("lead", text(blog, "lead", 200, false)));

    Map<String, Object> work = obj(in.get("work"), "work", Set.of("lead", "projects"));
    List<Object> projects = new ArrayList<>();
    for (Object o : list(work.get("projects"), "work.projects", 12)) {
      Map<String, Object> p = obj(o, "work.projects", Set.of("name", "desc", "stack", "source", "demo", "post", "image", "live"));
      Map<String, Object> q = new LinkedHashMap<>();
      q.put("name", text(p, "name", 40, true));
      q.put("desc", text(p, "desc", 200, false));
      q.put("stack", text(p, "stack", 80, false));
      q.put("source", web(p, "source"));
      q.put("demo", web(p, "demo"));
      /* the article about it, written as inside [[ ]]: the build finds it (or notes that it cannot) */
      q.put("post", text(p, "post", 160, false));
      String image = text(p, "image", 300, false);
      if (!image.isEmpty() && !Posts.image(image) && !WEB.matcher(image).matches()) throw bad("作品截图要填 /images/ 开头的地址");
      q.put("image", image);
      /* a live picture instead of a screenshot: for now only the home page's planet */
      String live = text(p, "live", 20, false);
      if (!live.isEmpty() && !live.equals("planet")) throw bad("动态画面只能填 planet 或者空着");
      if (!live.isEmpty()) q.put("live", live);
      projects.add(q);
    }
    out.put("work", ordered("lead", text(work, "lead", 200, false), "projects", projects));

    /* "listening" above: the card is gone, but a home page saved while it existed may still carry it. It is let in, so
       that page can be saved again, and dropped here */

    Map<String, Object> lab = obj(in.get("lab"), "lab", Set.of("lead", "services"));
    List<Object> services = new ArrayList<>();
    for (Object o : list(lab.get("services"), "lab.services", 12)) {
      Map<String, Object> s = obj(o, "lab.services", Set.of("name", "host", "status"));
      String status = text(s, "status", 20, true);
      if (!status.equals("up") && !status.equals("maintenance")) throw bad("服务状态只能是 up 或 maintenance");
      services.add(ordered("name", text(s, "name", 40, true), "host", text(s, "host", 80, false), "status", status));
    }
    out.put("lab", ordered("lead", text(lab, "lead", 200, false), "services", services));

    Map<String, Object> about = obj(in.get("about"), "about", Set.of("statement", "facts"));
    List<Object> facts = new ArrayList<>();
    for (Object o : list(about.get("facts"), "about.facts", 12)) {
      List<Object> pair = list(o, "about.facts", 2);
      if (pair.size() != 2) throw bad("“关于”里的每一项要有名称和内容");
      facts.add(List.of(Text.line(str(pair.get(0)), 20), Text.line(str(pair.get(1)), 80)));
    }
    out.put("about", ordered("statement", text(about, "statement", 600, false), "facts", facts));
    return out;
  }

  private static Http.Fail bad(String message) {
    return new Http.Fail(400, "site", message);
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> obj(Object o, String where, Set<String> allowed) {
    if (o == null) return Map.of();
    if (!(o instanceof Map)) throw bad("格式不对：" + where);
    Map<String, Object> m = (Map<String, Object>) o;
    for (String k : m.keySet()) if (!allowed.contains(k)) throw bad("不认识的设置：" + (where.isEmpty() ? k : where + "." + k));
    return m;
  }

  @SuppressWarnings("unchecked")
  private static List<Object> list(Object o, String where, int max) {
    if (o == null) return List.of();
    if (!(o instanceof List)) throw bad("格式不对：" + where);
    List<Object> l = (List<Object>) o;
    if (l.size() > max) throw bad(where + " 最多 " + max + " 项");
    return l;
  }

  private static String text(Map<String, Object> m, String key, int max, boolean required) {
    Object v = m.get(key);
    if (v != null && !(v instanceof String)) throw bad("格式不对：" + key);
    String s = Text.line(v == null ? "" : (String) v, max);
    if (required && s.isEmpty()) throw bad("有一项必填的没有填：" + key);
    return s;
  }

  private static String web(Map<String, Object> m, String key) {
    String s = text(m, key, 300, false);
    if (!s.isEmpty() && !WEB.matcher(s).matches()) throw bad("地址要以 https:// 开头：" + s);
    return s;
  }

  private static String str(Object o) {
    return o instanceof String s ? s : "";
  }

  private static Map<String, Object> ordered(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
    return m;
  }
}
