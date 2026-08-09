import { beforeEach, describe, expect, it, vi } from "vitest";

import mainHtml from "../Unquote/Resources/Base.lproj/Main.html?raw";
import hostScript from "../Unquote/Resources/Script.js?raw";

type HostScript = {
  show: (enabled: unknown, useSettingsInsteadOfPreferences: boolean) => void;
};

type WebKitBridge = {
  messageHandlers: {
    controller: { postMessage: ReturnType<typeof vi.fn> };
  };
};

const loadHostScript = () => {
  const postMessage = vi.fn();
  const webkit: WebKitBridge = {
    messageHandlers: {
      controller: { postMessage },
    },
  };
  const execute = new Function("document", "webkit", `${hostScript}\nreturn { show };`) as (
    document: Document,
    webkit: WebKitBridge,
  ) => HostScript;

  return { host: execute(document, webkit), postMessage };
};

const element = (selector: string) => {
  const match = document.querySelector<HTMLElement>(selector);
  if (!match) {
    throw new Error(`Missing host element: ${selector}`);
  }

  return match;
};

describe("Safari host script", () => {
  beforeEach(() => {
    document.open();
    document.write(mainHtml);
    document.close();
  });

  it.each([
    { enabled: true, visibleState: "state-on" },
    { enabled: false, visibleState: "state-off" },
  ])("shows the $visibleState body state", ({ enabled, visibleState }) => {
    const { host } = loadHostScript();
    document.body.classList.add(enabled ? "state-off" : "state-on");

    host.show(enabled, false);

    expect(document.body.classList.contains(visibleState)).toBe(true);
    expect(document.body.classList.contains(enabled ? "state-off" : "state-on")).toBe(false);
  });

  it("shows the unknown state when enabled is not boolean", () => {
    const { host } = loadHostScript();
    document.body.classList.add("state-on", "state-off");

    host.show(null, false);

    expect(document.body.classList.contains("state-on")).toBe(false);
    expect(document.body.classList.contains("state-off")).toBe(false);
  });

  it("keeps the status copy in text-only nodes", () => {
    loadHostScript();

    expect(element(".state-on").children).toHaveLength(0);
    expect(element(".state-off").children).toHaveLength(0);
    expect(element(".state-unknown").children).toHaveLength(0);
  });

  it("uses Settings terminology when requested", () => {
    const { host } = loadHostScript();

    host.show(null, true);

    expect(element(".state-on").innerText).toBe(
      "Unquote’s extension is currently on. You can turn it off in the Extensions section of Safari Settings.",
    );
    expect(element(".state-off").innerText).toBe(
      "Unquote’s extension is currently off. You can turn it on in the Extensions section of Safari Settings.",
    );
    expect(element(".state-unknown").innerText).toBe(
      "You can turn on Unquote’s extension in the Extensions section of Safari Settings.",
    );
    expect(element(".open-preferences").innerText).toBe("Quit and Open Safari Settings…");
  });

  it("preserves Preferences terminology when Settings is not requested", () => {
    const { host } = loadHostScript();

    host.show(null, false);

    expect(element(".state-on").textContent).toContain("Safari Extensions preferences");
    expect(element(".state-off").textContent).toContain("Safari Extensions preferences");
    expect(element(".state-unknown").textContent).toContain("Safari Extensions preferences");
    expect(element(".open-preferences").textContent).toContain(
      "Quit and Open Safari Extensions Preferences…",
    );
  });

  it("posts the exact open-preferences bridge message once", () => {
    const { postMessage } = loadHostScript();

    element("button.open-preferences").click();

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith("open-preferences");
  });
});
