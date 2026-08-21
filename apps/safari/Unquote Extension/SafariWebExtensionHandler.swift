//
//  SafariWebExtensionHandler.swift
//  Unquote Extension
//
//  Created by Kevin Xing on 7/27/26.
//

import Foundation

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: nil, completionHandler: nil)
    }

}
