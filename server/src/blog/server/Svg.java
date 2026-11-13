package blog.server;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.w3c.dom.Attr;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NamedNodeMap;
import org.w3c.dom.Node;

/**
 * SVG pictures: diagrams exported from draw.io, Excalidraw, Mermaid and the like. An SVG is a document that can carry
 * script, so it is never kept as it was uploaded. It is read as XML, with no DOCTYPE allowed (so no entities, and
 * nothing is fetched while reading), and written again with only what draws: elements from a fixed list, in the SVG
 * namespace (plus plain HTML text inside foreignObject, which Mermaid and draw.io use for their labels), and their
 * attributes minus every event handler (on…), every link or reference that is not to a part of the picture itself or
 * an embedded bitmap, and anything that mentions a script: address. Animation elements go entirely (they can change
 * those attributes later). Stylesheets lose @import and url(…) to other addresses.
 * The site sends SVGs with a Content-Security-Policy that forbids running anything as well (deploy/Caddyfile, nginx.conf).
 */
final class Svg {
  private Svg() {}

  static final int MAX = 5 * 1024 * 1024;
  private static final String SVG_NS = "http://www.w3.org/2000/svg";
  private static final String XHTML_NS = "http://www.w3.org/1999/xhtml";
  private static final String XLINK_NS = "http://www.w3.org/1999/xlink";
  private static final String XMLNS_NS = XMLConstants.XMLNS_ATTRIBUTE_NS_URI;

  private static final Set<String> SVG_ELEMENTS = Set.of(
      "svg", "g", "defs", "symbol", "use", "switch", "title", "desc", "style", "a",
      "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
      "text", "tspan", "textPath", "image", "foreignObject",
      "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "marker",
      "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix", "feDiffuseLighting",
      "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR",
      "feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset", "fePointLight",
      "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence");
  /* the text of labels drawn as HTML inside <foreignObject> */
  private static final Set<String> HTML_ELEMENTS = Set.of(
      "div", "span", "p", "br", "b", "strong", "i", "em", "u", "s", "code", "pre", "sub", "sup", "small", "mark",
      "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "label", "font", "hr");
  private static final Pattern BITMAP = Pattern.compile("^data:image/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\\s]*$", Pattern.CASE_INSENSITIVE);
  private static final Pattern SCRIPTY = Pattern.compile("(javascript|vbscript|livescript)\\s*:|expression\\s*\\(|-moz-binding|behavior\\s*:", Pattern.CASE_INSENSITIVE);
  private static final Pattern URL = Pattern.compile("url\\(\\s*(['\"]?)(.*?)\\1\\s*\\)", Pattern.CASE_INSENSITIVE);
  private static final Pattern IMPORT = Pattern.compile("@import[^;]*;?", Pattern.CASE_INSENSITIVE);
  private static final Pattern NUMBER = Pattern.compile("^\\s*([0-9]*\\.?[0-9]+)\\s*(px)?\\s*$");
  private static final Pattern VIEWBOX = Pattern.compile("^\\s*-?[0-9.]+[\\s,]+-?[0-9.]+[\\s,]+([0-9.]+)[\\s,]+([0-9.]+)\\s*$");

  record Clean(byte[] data, int width, int height) {}

  /** Whether these bytes start like an SVG file (an XML declaration, a comment or the svg element itself). */
  static boolean looksLike(byte[] b) {
    String head = new String(b, 0, Math.min(b.length, 4096), StandardCharsets.UTF_8).replaceFirst("^﻿", "").stripLeading();
    if (!(head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--") || head.startsWith("<!DOCTYPE"))) return false;
    return head.contains("<svg");
  }

  /** The picture as it will be kept: only what draws (see the class comment), with its size. */
  static Clean clean(byte[] data) {
    if (data.length > MAX) throw new Http.Fail(413, "too_large", "SVG 太大了（最多 5 MB）");
    Document doc;
    try {
      DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
      f.setNamespaceAware(true);
      f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      f.setFeature("http://xml.org/sax/features/external-general-entities", false);
      f.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
      f.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
      f.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
      f.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
      f.setXIncludeAware(false);
      f.setExpandEntityReferences(false);
      DocumentBuilder b = f.newDocumentBuilder();
      b.setErrorHandler(null);
      doc = b.parse(new ByteArrayInputStream(data));
    } catch (Exception e) {
      String why = String.valueOf(e.getMessage());
      if (why.contains("DOCTYPE")) throw new Http.Fail(415, "bad_svg", "这个 SVG 带有 DOCTYPE 声明，为了安全不接受。删掉文件开头的 <!DOCTYPE …> 那一行再上传");
      throw new Http.Fail(415, "bad_svg", "这个 SVG 打不开（不是格式正确的 XML）");
    }
    Element root = doc.getDocumentElement();
    if (root == null || !"svg".equals(root.getLocalName()) || !SVG_NS.equals(root.getNamespaceURI())) {
      throw new Http.Fail(415, "bad_svg", "这不是 SVG 图片（最外层不是 <svg>，或者缺少 xmlns=\"http://www.w3.org/2000/svg\"）");
    }
    clean(root, false);
    for (Node n = doc.getFirstChild(); n != null; ) {
      Node next = n.getNextSibling();
      if (n != root) doc.removeChild(n); /* comments and processing instructions around the picture */
      n = next;
    }
    int[] size = size(root);
    try {
      TransformerFactory tf = TransformerFactory.newInstance();
      tf.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
      tf.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
      Transformer t = tf.newTransformer();
      t.setOutputProperty(OutputKeys.ENCODING, "UTF-8");
      t.setOutputProperty(OutputKeys.METHOD, "xml");
      ByteArrayOutputStream out = new ByteArrayOutputStream(data.length);
      t.transform(new DOMSource(doc), new StreamResult(out));
      return new Clean(out.toByteArray(), size[0], size[1]);
    } catch (Exception e) {
      throw new Http.Fail(415, "bad_svg", "这个 SVG 处理不了");
    }
  }

  /* one element and everything in it; html: inside a foreignObject, where plain HTML text is allowed */
  private static void clean(Element el, boolean html) {
    String ns = el.getNamespaceURI(), name = el.getLocalName();
    boolean svg = SVG_NS.equals(ns);
    boolean inHtml = html || (svg && "foreignObject".equals(name));
    attributes(el, svg ? name : "");
    if (svg && "style".equals(name)) el.setTextContent(css(el.getTextContent()));
    List<Node> kids = new ArrayList<>();
    for (Node n = el.getFirstChild(); n != null; n = n.getNextSibling()) kids.add(n);
    for (Node n : kids) {
      switch (n.getNodeType()) {
        case Node.ELEMENT_NODE -> {
          Element c = (Element) n;
          String cns = c.getNamespaceURI(), cname = c.getLocalName();
          boolean ok = (SVG_NS.equals(cns) && SVG_ELEMENTS.contains(cname)) || (inHtml && XHTML_NS.equals(cns) && HTML_ELEMENTS.contains(cname));
          if (ok) clean(c, inHtml);
          else el.removeChild(c);
        }
        case Node.TEXT_NODE, Node.CDATA_SECTION_NODE -> { /* words and the text of a stylesheet stay */ }
        default -> el.removeChild(n); /* comments, processing instructions */
      }
    }
  }

  private static void attributes(Element el, String svgName) {
    NamedNodeMap all = el.getAttributes();
    List<Attr> drop = new ArrayList<>();
    for (int i = 0; i < all.getLength(); i++) {
      Attr a = (Attr) all.item(i);
      String ans = a.getNamespaceURI();
      String local = a.getLocalName() != null ? a.getLocalName() : a.getName();
      String lower = local.toLowerCase(Locale.ROOT);
      String v = a.getValue();
      String plain = v.replaceAll("[\\u0000-\\u0020]", "").toLowerCase(Locale.ROOT);
      if (XMLNS_NS.equals(ans)) {
        if (!(SVG_NS.equals(v) || XLINK_NS.equals(v) || XHTML_NS.equals(v))) drop.add(a); /* inkscape:, sodipodi: … */
        continue;
      }
      boolean known = ans == null || XLINK_NS.equals(ans) || XMLConstants.XML_NS_URI.equals(ans);
      if (!known || lower.startsWith("on") || SCRIPTY.matcher(v).find() || SCRIPTY.matcher(plain).find()) { drop.add(a); continue; }
      if (lower.equals("href") || lower.equals("src") || lower.equals("action") || lower.equals("formaction")) {
        boolean bitmap = ("image".equals(svgName) || "feImage".equals(svgName)) && BITMAP.matcher(v.strip()).matches();
        if (!(v.strip().startsWith("#") || bitmap)) drop.add(a);
        continue;
      }
      if (lower.equals("style")) { a.setValue(css(v)); continue; }
      /* fill="url(#gradient)", marker-end="url(#arrow)": only references to the picture's own parts */
      if (v.toLowerCase(Locale.ROOT).contains("url(")) a.setValue(urls(v));
    }
    for (Attr a : drop) el.removeAttributeNode(a);
  }

  private static String css(String text) {
    String s = IMPORT.matcher(text).replaceAll("");
    s = SCRIPTY.matcher(s).replaceAll("");
    return urls(s);
  }

  private static String urls(String s) {
    Matcher m = URL.matcher(s);
    StringBuilder out = new StringBuilder();
    while (m.find()) {
      String target = m.group(2).strip();
      boolean own = target.startsWith("#") || BITMAP.matcher(target).matches();
      m.appendReplacement(out, Matcher.quoteReplacement(own ? m.group() : "none"));
    }
    m.appendTail(out);
    return out.toString();
  }

  /* width × height in CSS pixels: from width and height, or the viewBox; 0 when it says neither */
  private static int[] size(Element root) {
    double w = num(root.getAttribute("width")), h = num(root.getAttribute("height"));
    Matcher vb = VIEWBOX.matcher(root.getAttribute("viewBox"));
    if ((w == 0 || h == 0) && vb.matches()) {
      double vw = Double.parseDouble(vb.group(1)), vh = Double.parseDouble(vb.group(2));
      if (vw > 0 && vh > 0) {
        if (w > 0) h = w * vh / vw;
        else if (h > 0) w = h * vw / vh;
        else { w = vw; h = vh; }
      }
    }
    return new int[] {(int) Math.round(w), (int) Math.round(h)};
  }

  private static double num(String v) {
    Matcher m = NUMBER.matcher(v == null ? "" : v);
    return m.matches() ? Double.parseDouble(m.group(1)) : 0;
  }
}
