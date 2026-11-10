import SwiftUI

/// A list of trips: the first screen.
public struct TripsView: View {
    public struct Trip: Identifiable, Sendable {
        public let id = UUID()
        public var place: String
        public var dates: String
        public var nights: Int
    }

    let trips: [Trip]

    public init(trips: [Trip]) { self.trips = trips }

    public var body: some View {
        NavigationStack {
            List(trips) { trip in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(trip.place).font(.headline)
                        Text(trip.dates).font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("\(trip.nights) nights").font(.callout.monospacedDigit()).foregroundStyle(.tint)
                }
                .padding(.vertical, 4)
            }
            .navigationTitle("Trips")
        }
    }
}

/// One trip, with a packing checklist.
public struct TripDetailView: View {
    let place: String
    @State private var packed: Set<String> = ["Passport"]
    private let items = ["Passport", "Charger", "Rain jacket", "Walking shoes"]

    public init(place: String) { self.place = place }

    public var body: some View {
        Form {
            Section("Where") {
                LabeledContent("Place", value: place)
                LabeledContent("Leaving", value: "12 March")
            }
            Section("Packing") {
                ForEach(items, id: \.self) { item in
                    Toggle(item, isOn: Binding(
                        get: { packed.contains(item) },
                        set: { isOn in if isOn { packed.insert(item) } else { packed.remove(item) } }
                    ))
                }
            }
        }
    }
}

/// An empty state, drawn at its own size rather than a whole screen.
public struct EmptyTripsView: View {
    public init() {}

    public var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "suitcase").font(.system(size: 44)).foregroundStyle(.tint)
            Text("No trips yet").font(.title2.bold())
            Text("Plan one and it will show up here.").foregroundStyle(.secondary)
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

extension TripsView.Trip {
    public static let samples: [TripsView.Trip] = [
        .init(place: "Lisbon", dates: "12–16 March", nights: 4),
        .init(place: "Kyoto", dates: "2–9 April", nights: 7),
        .init(place: "Reykjavík", dates: "20–23 May", nights: 3),
    ]
}
