const icons = {
  "16": "icon16.png",
  "48": "icon48.png",
  "128": "icon128.png",
};

// Safari has no clipboardRead permission. Clipboard file paste already
// feature-detects navigator.clipboard.read, so it degrades on its own.
const basePermissions = ["alarms", "contextMenus", "storage"] as const;
const clipboardPermission = "clipboardRead";

export const safariBrowserTarget = "safari";

/**
 * The one definition of what the extension asks for. Every target — dev,
 * Chrome, Safari — builds from this, so a permission or command can only
 * differ where a browser genuinely differs.
 */
export const createExtensionManifest = (browser: string) => ({
  name: "__MSG_appName__",
  description: "__MSG_appDescription__",
  default_locale: "en",
  permissions:
    browser === safariBrowserTarget
      ? [...basePermissions]
      : [...basePermissions, clipboardPermission],
  commands: {
    open_unquote: {
      suggested_key: {
        default: "Ctrl+Shift+U",
        mac: "Command+Shift+U",
      },
      description: "__MSG_openUnquote__",
    },
  },
  action: {
    default_icon: icons,
  },
  icons,
});
