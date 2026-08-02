import NodusKit
import NodusUI
import SwiftUI

/// Adding a server: probe, sign in, pick a space.
///
/// Three steps rather than one form, because each answers a question the next one needs. The
/// probe is unauthenticated and settles "is this a Nodus Server and does this build understand
/// it" before asking for a password. Sign-in returns the spaces this account can reach, so the
/// space is chosen from a list rather than typed. Only then is a token minted, and it is bound
/// to exactly the space that was chosen.
struct ConnectView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private enum Step: Equatable {
        case address
        case credentials(ServerAddress, ServerCapabilities)
        case space(ServerAddress, LoginTicket)
    }

    @State private var step: Step = .address
    @State private var addressInput = ""
    @State private var email = ""
    @State private var password = ""
    @State private var pairingCode = ""
    @State private var usePairingCode = false
    @State private var error: String?
    @State private var isBusy = false

    private let accent = Color(hex: VaultType.academic.accentHex)

    var body: some View {
        NavigationStack {
            content
        }
        .onAppear {
            // Debug builds only: lets the verification loop skip retyping a local address on
            // every run. Release has no such path — see LabDefaults.
            guard let defaults = LabDefaults.current else { return }
            if addressInput.isEmpty { addressInput = defaults.address }
            if email.isEmpty { email = defaults.email }
            if password.isEmpty { password = defaults.password }
        }
    }

    private var content: some View {
        Group {
            ZStack {
                NodusBackdrop(accent: accent)
                ScrollView {
                    VStack(spacing: 22) {
                        header
                        switch step {
                        case .address: addressStep
                        case .credentials(let address, let capabilities): credentialsStep(address, capabilities)
                        case .space(let address, let ticket): spaceStep(address, ticket)
                        }
                        if let error {
                            Label(error, systemImage: "exclamationmark.triangle")
                                .font(.footnote)
                                .foregroundStyle(.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                                .nodusGlass(NodusGlass(.thin, tint: .red), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                    }
                    .padding(20)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            NodusMark(style: .accent(accent)).frame(width: 64, height: 64)
            Text("Conectar con un Nodus Server")
                .font(.title3.weight(.semibold))
            Text("Tu servidor guarda una proyección publicada del vault. Las claves de IA nunca salen de este dispositivo.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 12)
    }

    // MARK: Step 1

    private var addressStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Dirección del servidor").font(.subheadline.weight(.medium))
            TextField("nodus.ejemplo.org", text: $addressInput)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textFieldStyle(.plain)
                .padding(14)
                .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            Text("Se asume HTTPS. El servidor rechaza cualquier dirección pública que no lo sea.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button {
                Task { await probe() }
            } label: {
                Label("Continuar", systemImage: "arrow.right")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(NodusPrimaryButtonStyle(accent: accent))
            .disabled(addressInput.trimmingCharacters(in: .whitespaces).isEmpty || isBusy)
        }
        .padding(18)
        .nodusGlass(NodusGlass(.regular, tint: accent))
    }

    // MARK: Step 2

    private func credentialsStep(_ address: ServerAddress, _ capabilities: ServerCapabilities) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(capabilities.server.name).font(.subheadline.weight(.semibold))
                    Text(address.origin).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if address.isInsecure {
                    // Saying so is the point. A padlock this connection has not earned would be
                    // worse than no padlock at all.
                    Label("Sin cifrar", systemImage: "lock.open")
                        .font(.caption2).foregroundStyle(.orange)
                }
            }

            Picker("", selection: $usePairingCode) {
                Text("Cuenta").tag(false)
                Text("Código").tag(true)
            }
            .pickerStyle(.segmented)

            if usePairingCode {
                TextField("XXXX-XXXX", text: $pairingCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .textFieldStyle(.plain)
                    .padding(14)
                    .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text("Un código de emparejamiento caduca a los quince minutos y solo sirve una vez.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                TextField("Correo", text: $email)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                    .textFieldStyle(.plain)
                    .padding(14)
                    .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                SecureField("Contraseña", text: $password)
                    .textFieldStyle(.plain)
                    .padding(14)
                    .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }

            Button {
                Task { usePairingCode ? await pair(address) : await signIn(address) }
            } label: {
                Label(usePairingCode ? "Emparejar" : "Entrar", systemImage: "arrow.right")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(NodusPrimaryButtonStyle(accent: accent))
            .disabled(isBusy)
        }
        .padding(18)
        .nodusGlass(NodusGlass(.regular, tint: accent))
    }

    // MARK: Step 3

    private func spaceStep(_ address: ServerAddress, _ ticket: LoginTicket) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Elige un espacio").font(.subheadline.weight(.medium))
            Text("Cada espacio necesita su propio acceso: una credencial vale para uno solo.")
                .font(.caption).foregroundStyle(.secondary)

            if ticket.spaces.isEmpty {
                ContentUnavailableView(
                    "Sin espacios",
                    systemImage: "square.dashed",
                    description: Text("Esta cuenta todavía no tiene acceso a ningún espacio. Pídeselo a quien administra el servidor.")
                )
            }

            ForEach(ticket.spaces) { space in
                Button {
                    Task { await connect(address, ticket, space) }
                } label: {
                    SpaceRow(space: space)
                }
                .buttonStyle(.plain)
                .disabled(isBusy)
            }
        }
        .padding(18)
        .nodusGlass(NodusGlass(.regular, tint: accent))
    }

    // MARK: Actions

    private func probe() async {
        isBusy = true; error = nil
        defer { isBusy = false }
        do {
            let (address, capabilities) = try await model.probe(addressInput)
            step = .credentials(address, capabilities)
        } catch {
            self.error = describe(error)
        }
    }

    private func signIn(_ address: ServerAddress) async {
        isBusy = true; error = nil
        defer { isBusy = false }
        do {
            let ticket = try await model.signIn(to: address, email: email, password: password)
            password = ""
            step = .space(address, ticket)
        } catch {
            self.error = describe(error)
        }
    }

    private func pair(_ address: ServerAddress) async {
        isBusy = true; error = nil
        defer { isBusy = false }
        do {
            let connection = try await model.pair(to: address, code: pairingCode.uppercased())
            model.open(connection)
            dismiss()
        } catch {
            self.error = describe(error)
        }
    }

    private func connect(_ address: ServerAddress, _ ticket: LoginTicket, _ space: SpaceSummary) async {
        isBusy = true; error = nil
        defer { isBusy = false }
        do {
            let connection = try await model.connect(to: address, ticket: ticket, space: space)
            model.open(connection)
            dismiss()
        } catch {
            self.error = describe(error)
        }
    }

    /// Turn a server refusal into something a person can act on.
    private func describe(_ error: any Error) -> String {
        if let api = error as? APIError {
            switch api.code {
            case "invalid_credentials": return "Ese correo o esa contraseña no son correctos."
            case "invalid_ticket": return "El acceso caducó. Vuelve a entrar."
            case "rate_limited":
                let seconds = Int(api.retryAfter ?? 60)
                return "Demasiados intentos. Prueba de nuevo en \(seconds) s."
            default: return api.localizedDescription
            }
        }
        if let transport = error as? TransportError {
            if case .badServerURL = transport {
                return "Esa dirección no sirve. Escribe solo el dominio, sin rutas."
            }
            return transport.localizedDescription
        }
        return error.localizedDescription
    }
}

private struct SpaceRow: View {
    let space: SpaceSummary

    var body: some View {
        let accent = Color(hex: space.vault?.type?.accentHex ?? VaultType.academic.accentHex)
        HStack(spacing: 12) {
            NodusMark(style: .accent(accent)).frame(width: 30, height: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(space.name).font(.subheadline.weight(.medium))
                HStack(spacing: 6) {
                    Text(roleLabel(space.role)).font(.caption2)
                    if !space.hasSnapshot {
                        Text("· sin publicar").font(.caption2).foregroundStyle(.orange)
                    }
                }
                .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.28), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func roleLabel(_ role: SpaceRole) -> String {
        switch role {
        case .reader: return "Lectura"
        case .writer: return "Puede enviar cambios"
        case .owner: return "Propietario"
        }
    }
}
