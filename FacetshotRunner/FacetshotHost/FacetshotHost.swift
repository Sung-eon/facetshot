import SwiftUI

/// Nothing. A UI test bundle must name an app of its own to be built against; the app facetshot drives is yours,
/// reached by its bundle identifier.
@main
struct FacetshotHost: App {
    var body: some Scene { WindowGroup { EmptyView() } }
}
