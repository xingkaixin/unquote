enum SafariHostExtensionState: Equatable {
    case enabled
    case disabled
    case unknown

    init(isEnabled: Bool?, hasError: Bool) {
        guard !hasError, let isEnabled else {
            self = .unknown
            return
        }

        self = isEnabled ? .enabled : .disabled
    }

    var javaScriptValue: String {
        switch self {
        case .enabled:
            "true"
        case .disabled:
            "false"
        case .unknown:
            "null"
        }
    }
}

enum SafariHostAction: Equatable {
    case openPreferences
}

enum SafariHostContract {
    static let messageHandlerName = "controller"
    static let openPreferencesMessage = "open-preferences"

    static func showScript(
        for state: SafariHostExtensionState,
        useSettingsInsteadOfPreferences: Bool
    ) -> String {
        "show(\(state.javaScriptValue), \(useSettingsInsteadOfPreferences))"
    }

    static func action(for messageBody: Any) -> SafariHostAction? {
        guard let message = messageBody as? String, message == openPreferencesMessage else {
            return nil
        }

        return .openPreferences
    }
}
