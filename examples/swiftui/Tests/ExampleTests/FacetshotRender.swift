import ExampleViews
import FacetshotKit
import Testing

/// The screens facetshot pictures (`facetshot preview:'*' --on mac`). In an ordinary `swift test` run there is no
/// FACETSHOT_OUT, so this returns at once and passes.
@MainActor @Suite struct FacetshotRender {
    @Test func scenes() async throws {
        try await Facetshot.run([
            FacetshotScene("Trips/List") { TripsView(trips: TripsView.Trip.samples) },
            FacetshotScene("Trips/Detail") { TripDetailView(place: "Lisbon") },
            FacetshotScene("Trips/Empty", layout: .sizeThatFits) { EmptyTripsView() },
        ])
    }
}
