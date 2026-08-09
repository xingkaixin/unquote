//
//  ViewController.swift
//  Unquote
//
//  Created by Kevin Xing on 7/27/26.
//

import Cocoa
import SafariServices
import WebKit

let extensionBundleIdentifier = "com.xingkaixin.unquote.extension"

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(
            self,
            name: SafariHostContract.messageHandlerName
        )

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            let hostState = SafariHostExtensionState(
                isEnabled: state?.isEnabled,
                hasError: error != nil
            )

            let useSettingsInsteadOfPreferences: Bool
            if #available(macOS 13, *) {
                useSettingsInsteadOfPreferences = true
            } else {
                useSettingsInsteadOfPreferences = false
            }

            let script = SafariHostContract.showScript(
                for: hostState,
                useSettingsInsteadOfPreferences: useSettingsInsteadOfPreferences
            )

            DispatchQueue.main.async {
                webView.evaluateJavaScript(script)
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let action = SafariHostContract.action(for: message.body) else {
            return
        }

        switch action {
        case .openPreferences:
            SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in
                DispatchQueue.main.async {
                    NSApplication.shared.terminate(nil)
                }
            }
        }
    }

}
