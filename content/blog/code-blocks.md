---
title: 代码块：仿 Xcode 的语法高亮
date: 2026-10-24
series: 博客使用指南
tags: [Java, 博客]
description: 博客里代码块的样子：Xcode 配色、文件名、高亮行、行号、折叠和复制按钮，以及 Java、Kotlin、SQL、YAML 这些常用语言的效果。
---

用三个反引号包住代码，并在后面写上语言名。颜色参照 Xcode 的默认主题，跟着网站的明暗模式切换；
高亮在构建时就做好了，访客不用多下载任何脚本。

## 写法

代码块自动带行号（复制时不会带上行号），超过 30 行的会先折叠，只显示前 18 行，点底部的「展开全部代码」再看全部。
在语言名后面还可以加这些：

- `title="文件名"`：代码块顶上显示文件名
- `{行号}`：高亮某几行，比如 `{3}`、`{2,5-7}`
- `nolines`：不要行号
- `nofold`：再长也不折叠

````markdown
```java title="UserController.java" {8-9}
……
```
````

## Java

```java title="UserController.java" {8-9}
@RestController
@RequestMapping("/api/users")
public class UserController {

    private static final int PAGE_SIZE = 20;
    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    /** 根据 ID 查询用户，找不到时返回 404 */
    @GetMapping("/{id}")
    public ResponseEntity<User> get(@PathVariable Long id) {
        return userService.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping
    public List<User> list(@RequestParam(defaultValue = "0") int page) {
        return userService.findAll(PageRequest.of(page, PAGE_SIZE)).getContent();
    }
}
```

## 长代码会折叠

```java title="UserService.java"
@Service
@Transactional(readOnly = true)
public class UserService {

    private static final Duration CACHE_TTL = Duration.ofMinutes(10);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final StringRedisTemplate redis;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder, StringRedisTemplate redis) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.redis = redis;
    }

    public Optional<User> findById(Long id) {
        return userRepository.findById(id);
    }

    public Page<User> findAll(Pageable pageable) {
        return userRepository.findAll(pageable);
    }

    @Transactional
    public User register(String email, String rawPassword) {
        if (userRepository.existsByEmail(email)) {
            throw new IllegalArgumentException("邮箱已被注册：" + email);
        }
        User user = new User();
        user.setEmail(email.trim().toLowerCase());
        user.setPassword(passwordEncoder.encode(rawPassword));
        user.setCreatedAt(Instant.now());
        return userRepository.save(user);
    }

    @Transactional
    public void changePassword(Long id, String oldPassword, String newPassword) {
        User user = userRepository.findById(id).orElseThrow(() -> new NoSuchElementException("用户不存在"));
        if (!passwordEncoder.matches(oldPassword, user.getPassword())) {
            throw new IllegalArgumentException("原密码不正确");
        }
        user.setPassword(passwordEncoder.encode(newPassword));
        redis.delete("user:session:" + id); // 改密码后让旧登录失效
    }

    public long countActiveSince(Instant since) {
        String key = "user:active:" + since.getEpochSecond();
        String cached = redis.opsForValue().get(key);
        if (cached != null) return Long.parseLong(cached);
        long count = userRepository.countByLastLoginAfter(since);
        redis.opsForValue().set(key, String.valueOf(count), CACHE_TTL);
        return count;
    }
}
```

## 配置文件

```yaml title="application.yml"
server:
  port: 8080
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/app?useSSL=false
    username: app
  jpa:
    open-in-view: false   # 别在视图层懒加载
```

```xml title="pom.xml"
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

## SQL

```sql
SELECT u.id, u.name, COUNT(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at >= '2026-01-01'
GROUP BY u.id
ORDER BY orders DESC
LIMIT 10;
```

## 命令行

```bash
npm run build
rsync -az --delete-after dist/ user@your-server:/var/www/site/
export JAVA_HOME=/usr/lib/jvm/java-21   # 切换 JDK
echo "部署完成：$(date)"
```

## TypeScript

```ts
interface User {
  id: number;
  name: string;
}

export async function fetchUser(id: number): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) throw new Error(`请求失败：${res.status}`);
  return res.json();
}
```

## 改动对比

```diff
- private static final int PAGE_SIZE = 10;
+ private static final int PAGE_SIZE = 20;
```

行内代码用一对反引号，比如 `npm run dev` 会在本地启动预览。
