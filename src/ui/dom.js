// Tiny DOM helpers. Everything uses textContent so user data can never become markup.
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
  return node;
}

export function select(name, options, selectedValue) {
  const node = el("select", { name });
  for (const { value, label } of options) {
    const choice = el("option", { value, text: label ?? value });
    if (selectedValue !== undefined && String(value) === String(selectedValue))
      choice.selected = true;
    node.append(choice);
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function field(labelText, control) {
  return el("label", { class: "field" }, [
    el("span", { text: labelText }),
    control,
  ]);
}

// Number range input with a live readout.
export function range(name, min, max, step, value) {
  const readout = el("output", { text: String(value) });
  const input = el("input", {
    type: "range",
    name,
    min,
    max,
    step,
    value,
    oninput: (event) => {
      readout.textContent = event.target.value;
    },
  });
  return el("span", { class: "range" }, [input, readout]);
}
