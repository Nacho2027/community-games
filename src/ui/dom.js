// Minimal DOM helpers. Everything goes through textContent, so no player-supplied value
// can ever become markup.
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "html") throw new Error("use textContent, not html");
    else if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  // Flatten nested arrays: callers legitimately pass `[...panel(), node]`, and without this
  // the inner array is coerced to a string and appended as text rather than as elements.
  for (const child of [].concat(children).flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

// A short, pure-CSS celebration. No library, and it is skipped entirely for players who
// ask for reduced motion.
export function burst(count = 10) {
  const wrap = el("div", { class: "burst", "aria-hidden": "true" });
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const distance = 46 + (index % 3) * 16;
    wrap.append(
      el("i", {
        style: `--dx:${Math.round(Math.cos(angle) * distance)}px;--dy:${Math.round(
          Math.sin(angle) * distance - 26,
        )}px;animation-delay:${index * 22}ms`,
      }),
    );
  }
  return wrap;
}
