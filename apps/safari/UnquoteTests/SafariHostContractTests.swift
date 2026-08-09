import Foundation
import XCTest
@testable import Unquote

@MainActor
final class SafariHostContractTests: XCTestCase {
    func testDefinesTheJavaScriptBridgeProtocol() {
        XCTAssertEqual(SafariHostContract.messageHandlerName, "controller")
        XCTAssertEqual(SafariHostContract.openPreferencesMessage, "open-preferences")
    }

    func testMapsKnownExtensionStates() {
        XCTAssertEqual(
            SafariHostExtensionState(isEnabled: true, hasError: false),
            .enabled
        )
        XCTAssertEqual(
            SafariHostExtensionState(isEnabled: false, hasError: false),
            .disabled
        )
    }

    func testMapsMissingOrFailedExtensionStateToUnknown() {
        XCTAssertEqual(
            SafariHostExtensionState(isEnabled: nil, hasError: false),
            .unknown
        )
        XCTAssertEqual(
            SafariHostExtensionState(isEnabled: true, hasError: true),
            .unknown
        )
    }

    func testBuildsPresentationCommandsForSettingsAndPreferences() {
        XCTAssertEqual(
            SafariHostContract.showScript(
                for: .enabled,
                useSettingsInsteadOfPreferences: true
            ),
            "show(true, true)"
        )
        XCTAssertEqual(
            SafariHostContract.showScript(
                for: .disabled,
                useSettingsInsteadOfPreferences: false
            ),
            "show(false, false)"
        )
        XCTAssertEqual(
            SafariHostContract.showScript(
                for: .unknown,
                useSettingsInsteadOfPreferences: true
            ),
            "show(null, true)"
        )
    }

    func testDecodesOnlyTheOpenPreferencesMessage() {
        XCTAssertEqual(
            SafariHostContract.action(for: "open-preferences"),
            .openPreferences
        )
        XCTAssertEqual(
            SafariHostContract.action(for: "open-preferences" as NSString),
            .openPreferences
        )
        XCTAssertNil(SafariHostContract.action(for: "unknown"))
        XCTAssertNil(SafariHostContract.action(for: ["command": "open-preferences"]))
        XCTAssertNil(SafariHostContract.action(for: 1))
        XCTAssertNil(SafariHostContract.action(for: NSNull()))
    }
}
