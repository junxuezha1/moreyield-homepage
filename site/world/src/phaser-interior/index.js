import { mountPhaserCore } from "../../stages/phaser-core/stage.js";

const CONTENT_URLS = Object.freeze({
  profile: new URL("../content/profile.json", import.meta.url),
  projects: new URL("../content/projects.json", import.meta.url),
  contact: new URL("../content/contact.json", import.meta.url),
  interactionMap: new URL("../content/interaction-map.json", import.meta.url)
});

function element(tag, className, attributes = {}) {
  const node = document.createElement(tag);
  node.className = className;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Content request failed (${response.status}): ${url.pathname}`);
  return response.json();
}

async function loadContentBundle() {
  const [profile, projects, contact, interactionMap] = await Promise.all(Object.values(CONTENT_URLS).map(loadJson));
  const contracts = new Map(interactionMap.interactions.map((interaction) => [interaction.triggerId, interaction]));
  return { profile, projects, contact, contracts };
}

function paragraph(text, className = "") {
  const node = element("p", className);
  node.textContent = text;
  return node;
}

function renderEmptyState(title, note, kind) {
  const state = element("div", "phaser-interior__empty", { "data-empty-kind": kind });
  state.append(
    paragraph(title, "phaser-interior__empty-title"),
    paragraph(note, "phaser-interior__empty-note")
  );
  return state;
}

/*
 * Lucide static v0.468.0, ISC License.
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
 * part of Feather (MIT). All other copyright (c) for Lucide are held by
 * Lucide Contributors 2022.
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
const ICON_PATHS = Object.freeze({
  previous: ["m12 19-7-7 7-7", "M19 12H5"],
  next: ["M5 12h14", "m12 5 7 7-7 7"],
  external: ["M7 7h10v10", "M7 17 17 7"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  complete: ["M20 6 9 17l-5-5"]
});

function icon(name) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  for (const [key, value] of Object.entries({
    class: "phaser-interior__icon lucide",
    "aria-hidden": "true",
    width: "24",
    height: "24",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  })) svg.setAttribute(key, value);
  for (const definition of ICON_PATHS[name] || []) {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", definition);
    svg.append(path);
  }
  return svg;
}

function projectImage(project, className, eager = false) {
  if (!project.image?.src) return null;
  return element("img", className, {
    src: project.image.src,
    alt: project.image.alt || project.title,
    loading: eager ? "eager" : "lazy",
    decoding: "async",
    draggable: "false"
  });
}

function renderProjectMeta(project) {
  const meta = element("div", "phaser-interior__project-meta");
  if (project.category) meta.append(paragraph(project.category, "phaser-interior__project-category"));
  if (project.statusLabel) meta.append(paragraph(project.statusLabel, "phaser-interior__project-status"));
  return meta;
}

function renderProjectTags(project) {
  const list = element("ul", "phaser-interior__project-tags", { "aria-label": "项目领域" });
  for (const tag of project.tags || []) {
    const item = element("li", "");
    item.textContent = tag;
    list.append(item);
  }
  return list;
}

function renderProjectLinks(project) {
  const links = element("div", "phaser-interior__project-links");
  for (const item of project.links || []) {
    let destination;
    try {
      destination = new URL(item.url, window.location.href);
    } catch {
      continue;
    }
    if (!["https:", "http:"].includes(destination.protocol)) continue;
    const link = element("a", "phaser-interior__project-link", {
      href: destination.href,
      target: "_blank",
      rel: "noopener noreferrer"
    });
    link.append(document.createTextNode(item.label || "访问项目"), icon("external"));
    links.append(link);
  }
  return links;
}

function syncPortfolioNavigation(list) {
  if (!list) return;
  const navigation = list.previousElementSibling;
  const limit = Math.max(0, list.scrollWidth - list.clientWidth);
  navigation.querySelector('[data-direction="previous"]').disabled = list.scrollLeft <= 2;
  navigation.querySelector('[data-direction="next"]').disabled = list.scrollLeft >= limit - 2;
}

function renderProjects(bundle, onSelect) {
  const fragment = document.createDocumentFragment();
  const projects = (bundle.projects.projects || []).filter((project) => project.portfolioEligible === true);
  if (!projects.length) {
    fragment.append(renderEmptyState("新的作品，正在路上", "从一个想法开始，到真实世界里交付。", "projects"));
    return fragment;
  }
  const introduction = element("header", "phaser-interior__portfolio-intro");
  introduction.append(
    paragraph("MOREYIELD / SELECTED WORK", "phaser-interior__eyebrow"),
    paragraph(bundle.projects.title || bundle.projects.headline || "让想法走进真实世界。", "phaser-interior__portfolio-headline"),
    paragraph(bundle.projects.intro || bundle.projects.description || "从 AI 基础设施到独立产品，每一件作品，都是一次亲自下场。", "phaser-interior__portfolio-description")
  );
  const navigation = element("nav", "phaser-interior__portfolio-navigation", { "aria-label": "作品浏览" });
  navigation.append(paragraph(`${projects.length} 件作品`, "phaser-interior__portfolio-count"));
  const list = element("div", "phaser-interior__projects", {
    id: "phaser-projects",
    role: "region",
    "aria-label": "作品列表",
    tabindex: "0"
  });
  const scrollBehavior = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
  for (const direction of ["previous", "next"]) {
    const label = direction === "previous" ? "向左浏览作品" : "向右浏览作品";
    const button = element("button", "phaser-interior__portfolio-arrow", {
      type: "button",
      "data-direction": direction,
      "aria-controls": list.id,
      "aria-label": label,
      title: label
    });
    button.append(icon(direction));
    button.disabled = direction === "previous";
    button.addEventListener("click", () => {
      const step = list.firstElementChild.getBoundingClientRect().width + parseFloat(getComputedStyle(list).columnGap);
      const targetIndex = Math.round(list.scrollLeft / step) + (direction === "previous" ? -1 : 1);
      list.scrollTo({ left: targetIndex * step, behavior: scrollBehavior() });
    });
    navigation.append(button);
  }
  for (const [index, project] of projects.entries()) {
    const item = element("article", "phaser-interior__project", { "data-project-id": project.id });
    const button = element("button", "phaser-interior__project-open", {
      type: "button",
      "aria-label": `查看 ${project.title}`
    });
    const image = projectImage(project, "phaser-interior__project-image", index === 0);
    const text = element("div", "phaser-interior__project-copy");
    const title = element("h3", "phaser-interior__project-title");
    title.textContent = project.title;
    const titleRow = element("div", "phaser-interior__project-title-row");
    titleRow.append(title, icon("next"));
    text.append(renderProjectMeta(project), titleRow);
    if (project.headline || project.summary) text.append(paragraph(project.headline || project.summary, "phaser-interior__project-summary"));
    text.append(renderProjectTags(project));
    button.append(text);
    if (image) button.append(image);
    button.addEventListener("click", () => onSelect(project, button));
    item.append(button);
    list.append(item);
  }
  list.addEventListener("scroll", () => syncPortfolioNavigation(list), { passive: true });
  list.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const items = [...list.children];
    const focusedIndex = items.findIndex((item) => item.contains(document.activeElement));
    const step = items[0].getBoundingClientRect().width + parseFloat(getComputedStyle(list).columnGap);
    const currentIndex = focusedIndex < 0 ? Math.round(list.scrollLeft / step) : focusedIndex;
    const targetIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, currentIndex + (event.key === "ArrowLeft" ? -1 : 1)));
    items[targetIndex].querySelector("button").focus({ preventScroll: true });
    list.scrollTo({ left: targetIndex * step, behavior: scrollBehavior() });
  });
  fragment.append(introduction, navigation, list);
  window.requestAnimationFrame(() => list.isConnected && syncPortfolioNavigation(list));
  return fragment;
}

function renderProjectDetail(project) {
  const fragment = element("article", "phaser-interior__project-sheet");
  const introduction = element("header", "phaser-interior__project-intro");
  introduction.append(renderProjectMeta(project));
  if (project.headline) introduction.append(paragraph(project.headline, "phaser-interior__project-headline"));
  if (project.summary) introduction.append(paragraph(project.summary, "phaser-interior__project-description"));
  introduction.append(renderProjectLinks(project));
  fragment.append(introduction);
  const image = projectImage(project, "phaser-interior__project-detail-image", true);
  if (image) fragment.append(image);
  if (project.highlights?.length) {
    const section = element("section", "phaser-interior__project-highlights");
    const title = element("h3", "phaser-interior__project-section-title");
    title.textContent = "我把它做成了什么";
    const list = element("ul", "phaser-interior__project-highlight-list");
    for (const text of project.highlights) {
      const item = element("li", "");
      item.textContent = text;
      list.append(item);
    }
    section.append(title, list);
    fragment.append(section);
  }
  const footer = element("footer", "phaser-interior__project-detail-footer");
  footer.append(renderProjectTags(project));
  fragment.append(footer);
  return fragment;
}

function approvedContactChannels(contact) {
  return (contact.channels || []).filter((channel) => {
    if (channel.publicApproved !== true && channel.approved !== true) return false;
    const href = String(channel.href || channel.url || "");
    if (!href) return channel.kind === "text";
    return href.startsWith("mailto:")
      ? contact.privacy?.publicEmailApproved === true
      : contact.privacy?.externalLinksApproved === true;
  });
}

function renderContact(bundle) {
  const fragment = document.createDocumentFragment();
  const channels = approvedContactChannels(bundle.contact);
  if (!channels.length) {
    fragment.append(renderEmptyState(
      "保持联系",
      "期待与你聊聊 AI、产品，以及值得长期投入的问题。",
      "contact"
    ));
    return fragment;
  }
  if (bundle.contact.intro) fragment.append(paragraph(bundle.contact.intro, "phaser-interior__contact-intro"));
  const list = element("ul", "phaser-interior__contact-list");
  for (const channel of channels) {
    const item = element("li", "phaser-interior__contact-item", { "data-contact-kind": channel.kind || "profile" });
    const platform = element("span", "phaser-interior__contact-platform");
    platform.textContent = channel.platform || channel.label || channel.name;
    const value = element("span", "phaser-interior__contact-value");
    value.textContent = channel.value || channel.label || channel.name;
    item.append(platform, value);
    const href = channel.href || channel.url;
    if (href) {
      const link = element("a", "phaser-interior__contact-link", { href });
      link.textContent = channel.linkLabel || "打开";
      link.setAttribute("aria-label", channel.accessibilityLabel || `${platform.textContent}：${value.textContent}`);
      if (!href.startsWith("mailto:")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.append(icon("external"));
      }
      item.append(link);
    }
    list.append(item);
  }
  fragment.append(list);
  if (bundle.contact.note) fragment.append(paragraph(bundle.contact.note, "phaser-interior__contact-note"));
  return fragment;
}

export function mountPhaserInterior(container, options = {}) {
  if (!(container instanceof Element)) throw new TypeError("mountPhaserInterior requires a DOM Element container");
  if (container.__phaserInteriorMount) return container.__phaserInteriorMount;

  const root = element("section", "phaser-interior", {
    "aria-label": options.ariaLabel || "Moreyield 的世界 · 内景",
    tabindex: "-1"
  });
  const gameHost = element("div", "phaser-interior__game", { "aria-label": "Phaser 内景舞台" });
  const hud = element("div", "phaser-interior__hud", { "aria-live": "polite" });
  const location = element("span", "phaser-interior__location");
  location.textContent = "Moreyield 的世界";
  const objective = element("span", "phaser-interior__objective");
  objective.textContent = "当前目标 · 载入内景";
  hud.append(location, objective);

  const keyboardHint = element("div", "phaser-interior__keyboard-hint", { "aria-hidden": "true" });
  keyboardHint.innerHTML = '<span><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> 移动</span><span><kbd>Space</kbd> 跳跃</span><span><kbd>E</kbd> 互动</span><span><kbd>Esc</kbd> 暂停</span>';

  const actionButton = element("button", "phaser-interior__action", { type: "button" });
  actionButton.hidden = true;
  const pauseButton = element("button", "phaser-interior__pause", {
    type: "button",
    "aria-label": "暂停游戏",
    title: "暂停游戏",
    disabled: ""
  });
  pauseButton.innerHTML = '<span aria-hidden="true">Ⅱ</span>';

  const touchControls = element("div", "phaser-interior__touch-controls", { "aria-label": "移动控制" });
  const directionControls = element("div", "phaser-interior__directions");
  const makeTouchButton = (input, label, glyph) => {
    const button = element("button", "phaser-interior__touch-button", {
      type: "button",
      "data-input": input,
      "aria-label": label,
      title: label,
      disabled: ""
    });
    button.innerHTML = `<span aria-hidden="true">${glyph}</span>`;
    return button;
  };
  const leftButton = makeTouchButton("left", "向左移动", "←");
  const rightButton = makeTouchButton("right", "向右移动", "→");
  const jumpButton = makeTouchButton("jump", "跳跃", "↑");
  jumpButton.classList.add("phaser-interior__touch-button--jump");
  directionControls.append(leftButton, rightButton);
  touchControls.append(directionControls, jumpButton);

  const backdrop = element("div", "phaser-interior__backdrop");
  backdrop.hidden = true;
  const dialog = element("section", "phaser-interior__dialog", {
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "phaser-content-title",
    tabindex: "-1"
  });
  const dialogHead = element("header", "phaser-interior__dialog-head");
  const backButton = element("button", "phaser-interior__back", {
    type: "button",
    "aria-label": "返回作品集",
    title: "返回作品集"
  });
  backButton.append(icon("previous"));
  backButton.hidden = true;
  const dialogTitle = element("h2", "phaser-interior__dialog-title", { id: "phaser-content-title" });
  const closeButton = element("button", "phaser-interior__close", {
    type: "button",
    "aria-label": "关闭",
    title: "关闭"
  });
  closeButton.append(icon("close"));
  dialogHead.append(backButton, dialogTitle, closeButton);
  const dialogBody = element("div", "phaser-interior__dialog-body", { tabindex: "0" });
  dialog.append(dialogHead, dialogBody);
  backdrop.append(dialog);

  const pauseBackdrop = element("div", "phaser-interior__pause-backdrop");
  pauseBackdrop.hidden = true;
  const pauseMenu = element("section", "phaser-interior__pause-menu", {
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "phaser-pause-title"
  });
  const pauseTitle = element("h2", "phaser-interior__pause-title", { id: "phaser-pause-title" });
  pauseTitle.textContent = "游戏暂停";
  const pauseActions = element("div", "phaser-interior__pause-actions");
  const resumeButton = element("button", "phaser-interior__menu-action phaser-interior__menu-action--primary", { type: "button" });
  resumeButton.textContent = "继续";
  const instructionsButton = element("button", "phaser-interior__menu-action", {
    type: "button",
    "aria-expanded": "false",
    "aria-controls": "phaser-control-instructions"
  });
  instructionsButton.textContent = "控制说明";
  const returnButton = element("button", "phaser-interior__menu-action phaser-interior__menu-action--exit", { type: "button" });
  returnButton.textContent = "返回外景";
  pauseActions.append(resumeButton, instructionsButton, returnButton);
  const instructions = element("div", "phaser-interior__instructions", { id: "phaser-control-instructions" });
  instructions.hidden = true;
  instructions.innerHTML = `
    <div class="phaser-interior__instructions-desktop">
      <p><span>移动</span><span><kbd>A</kbd><kbd>D</kbd> 或 <kbd>←</kbd><kbd>→</kbd></span></p>
      <p><span>跳跃</span><kbd>Space</kbd></p>
      <p><span>互动</span><kbd>E</kbd></p>
      <p><span>暂停</span><kbd>Esc</kbd></p>
    </div>
    <div class="phaser-interior__instructions-touch">
      <p><span>移动</span><span aria-hidden="true">←　→</span></p>
      <p><span>跳跃</span><span aria-hidden="true">↑</span></p>
      <p><span>互动</span><span>轻触提示</span></p>
      <p><span>暂停</span><span aria-hidden="true">Ⅱ</span></p>
    </div>`;
  const assetCredits = element("a", "phaser-interior__asset-credits", {
    href: new URL("../../public/assets/landmarks/credits.html", import.meta.url).href,
    target: "_blank",
    rel: "noopener noreferrer"
  });
  assetCredits.textContent = "素材署名";
  pauseMenu.append(pauseTitle, pauseActions, instructions, assetCredits);
  pauseBackdrop.append(pauseMenu);
  const lifeFeedback = element("div", "phaser-interior__life-feedback", {
    role: "status",
    "aria-live": "polite"
  });
  lifeFeedback.hidden = true;
  const lifeSignal = element("span", "phaser-interior__life-signal", { "aria-hidden": "true" });
  lifeSignal.textContent = "◆";
  const lifeLabel = element("span", "phaser-interior__life-label");
  lifeFeedback.append(lifeSignal, lifeLabel);
  root.append(gameHost, hud, keyboardHint, actionButton, pauseButton, touchControls, backdrop, pauseBackdrop, lifeFeedback);
  container.replaceChildren(root);

  let destroyed = false;
  let contentBundle = null;
  let nearbyTriggerId = null;
  let activeTriggerId = null;
  let dialoguePath = [];
  let returnToDialogue = false;
  let activeProject = null;
  let portfolioScrollTop = 0;
  let portfolioScrollLeft = 0;
  let restoreFocusTo = null;
  let core = null;
  let lifeFeedbackTimer = 0;
  const activePointers = new Map();
  const eventController = new AbortController();
  const eventSignal = { signal: eventController.signal };

  const contractFor = (triggerId) => contentBundle?.contracts.get(triggerId);
  const syncObjective = () => {
    const contract = contractFor(nearbyTriggerId);
    objective.textContent = contract
      ? `当前目标 · ${contract.accessibilityName}`
      : "当前目标 · 探索并靠近角色或物件";
  };
  const syncTouchInput = () => {
    const activeInputs = new Set(activePointers.values());
    for (const button of [leftButton, rightButton, jumpButton]) {
      button.classList.toggle("is-held", activeInputs.has(button.dataset.input));
    }
    core?.runtime?.setInput({
      left: activeInputs.has("left"),
      right: activeInputs.has("right"),
      jump: activeInputs.has("jump")
    });
  };
  const clearTouchInput = () => {
    activePointers.clear();
    syncTouchInput();
  };
  const syncRuntimeBlocked = () => {
    clearTouchInput();
    core?.runtime?.setInteractionBlocked(!backdrop.hidden || !pauseBackdrop.hidden);
  };
  const closeDialog = () => {
    if (backdrop.hidden) return;
    options.onSound?.("interact");
    backdrop.hidden = true;
    root.dataset.panelOpen = "false";
    syncRuntimeBlocked();
    const target = restoreFocusTo?.isConnected ? restoreFocusTo : (actionButton.hidden ? root : actionButton);
    target.focus({ preventScroll: true });
    activeTriggerId = null;
    dialoguePath = [];
    returnToDialogue = false;
    activeProject = null;
    delete root.dataset.activeTrigger;
    delete root.dataset.activeObjectType;
    delete root.dataset.dialogView;
    delete root.dataset.projectId;
    delete root.dataset.dialogueNode;
    syncObjective();
  };

  const closePauseMenu = () => {
    if (pauseBackdrop.hidden) return;
    options.onSound?.("interact");
    pauseBackdrop.hidden = true;
    root.dataset.menuOpen = "false";
    instructions.hidden = true;
    instructionsButton.setAttribute("aria-expanded", "false");
    syncRuntimeBlocked();
    const target = restoreFocusTo?.isConnected ? restoreFocusTo : root;
    target.focus({ preventScroll: true });
    restoreFocusTo = null;
  };

  const openPauseMenu = (source = document.activeElement) => {
    if (!backdrop.hidden || !pauseBackdrop.hidden) return;
    options.onSound?.("interact");
    restoreFocusTo = source instanceof HTMLElement ? source : root;
    pauseBackdrop.hidden = false;
    root.dataset.menuOpen = "true";
    syncRuntimeBlocked();
    resumeButton.focus({ preventScroll: true });
  };

  const setBackAction = (label) => {
    backButton.hidden = !label;
    if (!label) return;
    backButton.setAttribute("aria-label", label);
    backButton.title = label;
  };
  const renderDialogMessage = (focusChoiceId) => {
    const entry = contentBundle.profile.npcDialogs.find((item) => item.id === "moreyield_active_intro");
    const node = dialoguePath.at(-1) || entry;
    root.dataset.dialogView = "dialogue";
    root.dataset.dialogueNode = dialoguePath.length ? node.id : "welcome";
    dialogTitle.textContent = entry.speaker;
    setBackAction(dialoguePath.length ? "返回话题" : null);
    const section = element("section", "phaser-interior__conversation", {
      tabindex: "-1",
      "aria-labelledby": "phaser-dialogue-heading"
    });
    const heading = element("h3", "phaser-interior__conversation-title", { id: "phaser-dialogue-heading", tabindex: "-1" });
    heading.textContent = node.greeting || node.title || node.label;
    section.append(heading);
    if (node.text) section.append(paragraph(node.text, "phaser-interior__conversation-text"));
    if (node.prompt) section.append(paragraph(node.prompt, "phaser-interior__conversation-prompt"));
    if (node.choices?.length) {
      const choices = element("div", "phaser-interior__dialogue-choices", { role: "group", "aria-label": "对话选项" });
      for (const choice of node.choices) {
        const button = element("button", "phaser-interior__dialogue-choice", {
          type: "button",
          "data-dialogue-choice": choice.id
        });
        button.append(document.createTextNode(choice.label), icon("next"));
        button.addEventListener("click", () => {
          dialoguePath.push(choice);
          renderDialogMessage();
        });
        choices.append(button);
      }
      section.append(choices);
    }
    if (node.targetTriggerId && contractFor(node.targetTriggerId)) {
      const action = element("button", "phaser-interior__dialogue-link", {
        type: "button",
        "data-dialogue-action": node.targetTriggerId
      });
      action.append(document.createTextNode(node.actionLabel), icon("next"));
      action.addEventListener("click", () => {
        returnToDialogue = true;
        showInteractionContent(node.targetTriggerId);
        backButton.focus({ preventScroll: true });
      });
      section.append(action);
    }
    dialogBody.replaceChildren(section);
    dialogBody.scrollTop = 0;
    const previousChoice = [...section.querySelectorAll("[data-dialogue-choice]")]
      .find((button) => button.dataset.dialogueChoice === focusChoiceId);
    (previousChoice || heading).focus({ preventScroll: true });
  };
  const showProjectDetail = (project) => {
    portfolioScrollTop = dialogBody.scrollTop;
    portfolioScrollLeft = dialogBody.querySelector(".phaser-interior__projects")?.scrollLeft || 0;
    activeProject = project;
    root.dataset.dialogView = "project-detail";
    root.dataset.projectId = project.id;
    setBackAction("返回作品集");
    dialogTitle.textContent = project.title;
    dialogBody.replaceChildren(renderProjectDetail(project));
    dialogBody.scrollTop = 0;
    backButton.focus({ preventScroll: true });
  };
  const showProjects = (restorePosition = false) => {
    const previousProjectId = activeProject?.id;
    activeProject = null;
    root.dataset.dialogView = "portfolio";
    delete root.dataset.projectId;
    setBackAction(returnToDialogue ? "返回对话" : null);
    dialogTitle.textContent = "作品布告栏";
    dialogBody.replaceChildren(renderProjects(contentBundle, showProjectDetail));
    const list = dialogBody.querySelector(".phaser-interior__projects");
    if (list) list.scrollLeft = restorePosition ? portfolioScrollLeft : 0;
    dialogBody.scrollTop = restorePosition ? portfolioScrollTop : 0;
    if (restorePosition) {
      const project = [...dialogBody.querySelectorAll("[data-project-id]")].find((item) => item.dataset.projectId === previousProjectId);
      (project?.querySelector("button") || closeButton).focus({ preventScroll: true });
    }
  };

  const showInteractionContent = (triggerId) => {
    const contract = contractFor(triggerId);
    activeTriggerId = triggerId;
    dialogTitle.textContent = contract.accessibilityName;
    setBackAction(returnToDialogue ? "返回对话" : null);
    activeProject = null;
    delete root.dataset.dialogView;
    delete root.dataset.projectId;
    delete root.dataset.dialogueNode;
    root.dataset.activeTrigger = triggerId;
    root.dataset.activeObjectType = contract.objectType;
    if (triggerId === "interior.npc-moreyield") {
      renderDialogMessage();
    } else if (triggerId === "interior.project-workstation") {
      showProjects();
    } else if (triggerId === "interior.contact-mailbox") {
      dialogBody.replaceChildren(renderContact(contentBundle));
    } else {
      dialogBody.replaceChildren(paragraph(contract.emptyState || "内容待补充", "phaser-interior__empty"));
    }
    dialogBody.scrollTop = 0;
    objective.textContent = `当前目标 · ${contract.accessibilityName}`;
  };

  const openInteraction = (triggerId, source = actionButton) => {
    if (!contentBundle || !contractFor(triggerId) || !backdrop.hidden || !pauseBackdrop.hidden) return;
    options.onSound?.("interact");
    restoreFocusTo = source instanceof HTMLElement ? source : document.activeElement;
    dialoguePath = [];
    returnToDialogue = false;
    showInteractionContent(triggerId);
    backdrop.hidden = false;
    root.dataset.panelOpen = "true";
    syncRuntimeBlocked();
    closeButton.focus({ preventScroll: true });
  };

  const exit = (reason) => {
    if (destroyed || root.dataset.exiting === "true") return;
    root.dataset.exiting = "true";
    returnButton.disabled = true;
    returnButton.textContent = "正在返回";
    options.onExit?.({ reason });
  };

  const syncLifeFeedback = ({ state, reason } = {}) => {
    window.clearTimeout(lifeFeedbackTimer);
    root.dataset.lifeState = state || "ready";
    if (state === "falling") {
      lifeLabel.textContent = reason === "waterfall_void" ? "瀑布下坠" : "正在下坠";
      lifeFeedback.hidden = false;
    } else if (state === "respawning") {
      lifeLabel.textContent = "返回落脚点";
      lifeFeedback.hidden = false;
    } else if (state === "respawned") {
      lifeLabel.textContent = "已返回落脚点";
      lifeFeedback.hidden = false;
      lifeFeedbackTimer = window.setTimeout(() => {
        lifeFeedback.hidden = true;
        delete root.dataset.lifeState;
      }, 920);
    } else {
      lifeFeedback.hidden = true;
      delete root.dataset.lifeState;
    }
  };
  const trapFocus = (event, scope) => {
    const focusable = [...scope.querySelectorAll("button:not(:disabled), a[href], [tabindex='0']")].filter((node) => !node.closest("[hidden]"));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const handleKeydown = (event) => {
    if (!backdrop.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      } else if (event.key === "Tab") {
        trapFocus(event, dialog);
      }
      return;
    }
    if (!pauseBackdrop.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePauseMenu();
      } else if (event.key === "Tab") {
        trapFocus(event, pauseMenu);
      }
      return;
    }
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      openPauseMenu(root);
    }
  };

  actionButton.addEventListener("click", () => nearbyTriggerId && openInteraction(nearbyTriggerId, actionButton), eventSignal);
  pauseButton.addEventListener("click", () => openPauseMenu(pauseButton), eventSignal);
  resumeButton.addEventListener("click", closePauseMenu, eventSignal);
  returnButton.addEventListener("click", () => exit("pause-menu-return"), eventSignal);
  instructionsButton.addEventListener("click", () => {
    instructions.hidden = !instructions.hidden;
    instructionsButton.setAttribute("aria-expanded", String(!instructions.hidden));
  }, eventSignal);
  closeButton.addEventListener("click", closeDialog, eventSignal);
  backButton.addEventListener("click", () => {
    if (activeProject) {
      showProjects(true);
    } else if (returnToDialogue) {
      returnToDialogue = false;
      showInteractionContent("interior.npc-moreyield");
      dialogBody.querySelector("[data-dialogue-action]")?.focus({ preventScroll: true });
    } else if (activeTriggerId === "interior.npc-moreyield" && dialoguePath.length) {
      const previousChoice = dialoguePath.pop();
      renderDialogMessage(previousChoice.id);
    }
  }, eventSignal);
  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) closeDialog();
  }, eventSignal);
  document.addEventListener("keydown", handleKeydown, eventSignal);

  const releasePointer = (pointerId) => {
    if (!activePointers.delete(pointerId)) return;
    syncTouchInput();
  };
  for (const button of [leftButton, rightButton, jumpButton]) {
    button.addEventListener("pointerdown", (event) => {
      if (!backdrop.hidden || !pauseBackdrop.hidden || event.button !== 0) return;
      event.preventDefault();
      activePointers.set(event.pointerId, button.dataset.input);
      button.setPointerCapture?.(event.pointerId);
      syncTouchInput();
    }, { ...eventSignal, passive: false });
    button.addEventListener("pointerup", (event) => releasePointer(event.pointerId), eventSignal);
    button.addEventListener("pointercancel", (event) => releasePointer(event.pointerId), eventSignal);
    button.addEventListener("lostpointercapture", (event) => releasePointer(event.pointerId), eventSignal);
  }
  window.addEventListener("pointerup", (event) => releasePointer(event.pointerId), eventSignal);
  window.addEventListener("pointercancel", (event) => releasePointer(event.pointerId), eventSignal);
  window.addEventListener("blur", clearTouchInput, eventSignal);
  window.addEventListener("resize", () => syncPortfolioNavigation(dialogBody.querySelector(".phaser-interior__projects")), eventSignal);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTouchInput();
  }, eventSignal);

  const syncInteractionState = (interaction) => {
    nearbyTriggerId = interaction?.triggerId || null;
    if (!interaction || !contentBundle) {
      actionButton.hidden = true;
      if (contentBundle) syncObjective();
      return;
    }
    const contract = contractFor(interaction.triggerId);
    actionButton.hidden = false;
    actionButton.innerHTML = `<span aria-hidden="true">E</span><span>互动 · ${interaction.label}</span>`;
    actionButton.setAttribute("aria-label", contract?.accessibilityName || `与${interaction.label}互动`);
    syncObjective();
  };

  core = mountPhaserCore(gameHost, {
    publishGlobals: true,
    onInteraction: ({ triggerId, input }) => openInteraction(triggerId, input === "keyboard" ? root : document.activeElement),
    onInteractionStateChange: syncInteractionState,
    onLifeStateChange: syncLifeFeedback,
    onSound: options.onSound
  });

  const ready = Promise.all([core.ready, loadContentBundle()]).then(([, bundle]) => {
    if (destroyed) return;
    contentBundle = bundle;
    const runtimeIds = core.runtime.getSnapshot().interactions.objects.map((item) => item.triggerId);
    const missing = runtimeIds.filter((triggerId) => !bundle.contracts.has(triggerId));
    if (missing.length) throw new Error(`Interaction content contract missing: ${missing.join(", ")}`);
    root.dataset.ready = "true";
    root.dataset.contentSource = "interaction-map.json";
    pauseButton.disabled = false;
    for (const button of [leftButton, rightButton, jumpButton]) button.disabled = false;
    syncRuntimeBlocked();
    syncObjective();
    const nearby = core.runtime.getSnapshot().interactions;
    if (nearby.nearbyTriggerId) {
      const object = nearby.objects.find((item) => item.triggerId === nearby.nearbyTriggerId);
      syncInteractionState({ ...object, distance: nearby.distancePx });
    }
    root.focus({ preventScroll: true });
  }).catch((error) => {
    if (!destroyed) {
      root.dataset.error = "true";
      objective.textContent = "当前目标 · 内景加载失败";
      options.onFailure?.(error);
    }
    throw error;
  });

  const mount = {
    root,
    core,
    ready,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTouchInput();
      window.clearTimeout(lifeFeedbackTimer);
      eventController.abort();
      core.destroy();
      root.remove();
      delete container.__phaserInteriorMount;
    }
  };
  container.__phaserInteriorMount = mount;
  return mount;
}
