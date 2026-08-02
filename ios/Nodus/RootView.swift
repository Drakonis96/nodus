import NodusKit
import NodusUI
import SwiftUI

struct RootView: View {
    @State private var model = AppModel()
    @State private var ai = AISettings()
    @State private var tilt = DeviceTiltProvider()
    @State private var showingConnect = false

    var body: some View {
        Group {
            if let session = model.session {
                SpaceShell(session: session)
            } else {
                SpacePickerView(showingConnect: $showingConnect)
            }
        }
        .environment(model)
        .environment(ai)
        .detectingScreenCutout()
        .nodusTiltDriven(tilt)
        .sheet(isPresented: $showingConnect) { ConnectView().environment(model) }
        .task {
            // Reopen where the user left off, but only if the credential is still there — a
            // revoked token should land on the picker, not on a broken shell.
            if model.session == nil, let recent = model.mostRecent {
                model.open(recent)
            }
        }
    }
}

/// The list of spaces this device holds a credential for.
struct SpacePickerView: View {
    @Environment(AppModel.self) private var model
    @Binding var showingConnect: Bool

    private let accent = Color(hex: VaultType.academic.accentHex)

    var body: some View {
        ZStack {
            NodusBackdrop(accent: accent)
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 12) {
                        NodusMark(style: .brand).frame(width: 84, height: 84)
                        Text("Nodus").font(.largeTitle.weight(.semibold))
                        Text("Your vaults, wherever you are.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .padding(.top, 50)

                    if model.hasAnyConnection {
                        VStack(spacing: 10) {
                            ForEach(model.connections.sorted { ($0.lastOpenedAt ?? .distantPast) > ($1.lastOpenedAt ?? .distantPast) }) { connection in
                                Button {
                                    model.open(connection)
                                } label: {
                                    ConnectionCard(connection: connection)
                                }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    Button(role: .destructive) {
                                        model.forget(connection)
                                    } label: {
                                        Label("Olvidar", systemImage: "trash")
                                    }
                                }
                            }
                        }
                    } else {
                        NodusNotice(
                            tone: .info,
                            title: "No spaces yet",
                            message: "Connect to the Nodus Server where your vault is published.",
                            systemImage: "antenna.radiowaves.left.and.right"
                        )
                    }

                    Button {
                        showingConnect = true
                    } label: {
                        Label("Add a server", systemImage: "plus")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(NodusPrimaryButtonStyle(accent: accent))
                }
                .padding(20)
                // A 13-inch iPad is not a very wide iPhone. Stretching a list of four
                // connections across 1 000 points gives rows that are mostly empty and a line
                // length nobody reads comfortably.
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
        }
    }
}

private struct ConnectionCard: View {
    let connection: AppModel.Connection

    var body: some View {
        HStack(spacing: 13) {
            NodusMark(style: .accent(connection.accent)).frame(width: 38, height: 38)
            VStack(alignment: .leading, spacing: 3) {
                Text(connection.spaceName).font(.subheadline.weight(.semibold))
                Text("\(connection.serverName) · \(roleLabel)")
                    .font(.caption).foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .nodusGlass(NodusGlass(.regular, tint: connection.accent, interactive: true))
    }

    private var roleLabel: String {
        switch connection.role {
        case .reader: return "read"
        case .writer: return "write"
        case .owner: return "owner"
        }
    }
}

#Preview {
    RootView()
}
