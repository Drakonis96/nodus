import NodusKit
import NodusUI
import SwiftUI

/// The shell around an open space.
///
/// iPhone gets a tab bar; iPad gets the desktop's sidebar as a split view. Both share the same
/// header — the mark centred, the cutout absorbed into the chrome — and the same screens
/// underneath, because the difference is navigation, not content.
struct SpaceShell: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(AppModel.self) private var model

    let session: SpaceSession

    @State private var tab: Tab = .home
    @State private var sidebarSelection: SidebarItem? = .home
    @State private var showingSettings = false

    enum Tab: Hashable { case home, search, research, chat }

    enum SidebarItem: Hashable {
        case home
        case collection(String)
        case debates
        case notes
        case deepResearch
        case search
        case writing
        case research
        case chat
    }

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                splitView
            } else {
                tabView
            }
        }
        .task {
            await session.load()
            await session.loadMirror()
            await session.probeEmbedding()
        }
        .sheet(isPresented: $showingSettings) {
            SpaceSettingsView(session: session)
        }
    }

    // MARK: iPhone

    private var tabView: some View {
        // Four tabs, not five. "Explorar" showed the same sections as Home in a list instead
        // of a grid, so it cost a tab to say nothing new.
        TabView(selection: $tab) {
            page { HomeView(session: session) }
                .tabItem { Label("Inicio", systemImage: "house") }
                .tag(Tab.home)

            page { SearchScreen(session: session) }
                .tabItem { Label("Buscar", systemImage: "magnifyingglass") }
                .tag(Tab.search)

            page { ResearchView(session: session) }
                .tabItem { Label("Research", systemImage: "doc.text.magnifyingglass") }
                .tag(Tab.research)

            page { ChatTab(session: session) }
                .tabItem { Label("Chat", systemImage: "bubble.left.and.text.bubble.right") }
                .tag(Tab.chat)
        }
        .tint(session.accent)
    }

    /// Each tab is its own navigation stack.
    ///
    /// The header belongs to the *root* of the stack, not above the whole stack. Floating it
    /// over the TabView meant hiding the navigation bar everywhere to stop the two colliding —
    /// which also took the back button with it, and left a pushed list with no way out.
    /// Pushed screens keep the ordinary bar; only the root wears the mark.
    ///
    /// The backdrop goes inside each page rather than once behind the `TabView`: a TabView
    /// draws its own opaque page background over anything behind it, so a single shared
    /// backdrop showed up as plain black the moment a tab was selected.
    private func page<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        NavigationStack {
            content()
                .safeAreaInset(edge: .top) { header }
                .toolbar(.hidden, for: .navigationBar)
        }
        // Behind the whole stack, not behind the root's content: a pushed screen is a new
        // view, and a backdrop attached to the root simply is not under it.
        .background { NodusBackdrop(accent: session.accent).ignoresSafeArea() }
    }

    // MARK: iPad

    private var splitView: some View {
        NavigationSplitView {
            List(selection: $sidebarSelection) {
                Section {
                    Label("Inicio", systemImage: "house").tag(SidebarItem.home)
                    Label("Buscar", systemImage: "magnifyingglass").tag(SidebarItem.search)
                    Label("Research", systemImage: "doc.text.magnifyingglass").tag(SidebarItem.research)
                    Label("Chat", systemImage: "bubble.left.and.text.bubble.right").tag(SidebarItem.chat)
                }
                Section("Explorar") {
                    ForEach(session.sections, id: \.path) { collection in
                        Label {
                            HStack {
                                Text(collection.label)
                                Spacer()
                                CountBadge(count: session.count(of: collection), accent: session.accent)
                            }
                        } icon: {
                            Image(systemName: collection.icon)
                        }
                        .tag(SidebarItem.collection(collection.path))
                    }
                }
                if session.connection.role.canSendChanges {
                    Section("Escribir") {
                        Label("Notas y cola", systemImage: "square.and.pencil").tag(SidebarItem.writing)
                    }
                }
                if session.hasDebates || session.hasNotes || session.hasDeepResearch {
                    Section("Analizar") {
                        if session.hasDebates {
                            Label("Debates", systemImage: "bubble.left.and.bubble.right").tag(SidebarItem.debates)
                        }
                        if session.hasDeepResearch {
                            Label("Deep Research", systemImage: "doc.text.magnifyingglass").tag(SidebarItem.deepResearch)
                        }
                        if session.hasNotes {
                            Label("Notas", systemImage: "note.text").tag(SidebarItem.notes)
                        }
                    }
                }
            }
            .navigationTitle(session.connection.spaceName)
            .tint(session.accent)
            .safeAreaInset(edge: .top) { Color.clear.frame(height: 96) }
        } detail: {
            NavigationStack {
                detailContent
                    .safeAreaInset(edge: .top) { Color.clear.frame(height: 96) }
            }
        }
        .background { NodusBackdrop(accent: session.accent) }
        .overlay(alignment: .top) { header }
    }

    @ViewBuilder
    private var detailContent: some View {
        switch sidebarSelection {
        case .home, .none: HomeView(session: session)
        case .search: SearchScreen(session: session)
        case .research: ResearchView(session: session)
        case .chat: ChatTab(session: session)
        case .debates: SpecialListView(session: session, resource: .debates)
        case .notes: SpecialListView(session: session, resource: .notes)
        case .deepResearch: SpecialListView(session: session, resource: .deepResearch)
        case .writing: WritingView(session: session)
        case .collection(let path):
            if let collection = Collections[path] {
                CollectionListView(session: session, collection: collection)
            } else {
                ContentUnavailableView("Sección desconocida", systemImage: "questionmark.folder")
            }
        }
    }

    // MARK: Chrome

    private var header: some View {
        NodusHeader(
            title: session.connection.spaceName,
            subtitle: subtitle,
            accent: session.accent,
            activity: session.isLoading ? 1 : 0
        ) {
            Button {
                model.closeSession()
            } label: {
                Image(systemName: "rectangle.stack")
                    .font(.callout)
            }
            .tint(session.accent)
            .accessibilityLabel("Cambiar de espacio")
        } trailing: {
            Button {
                showingSettings = true
            } label: {
                Image(systemName: "gearshape")
                    .font(.callout)
            }
            .tint(session.accent)
            .accessibilityLabel("Ajustes")
        }
    }

    private var subtitle: String? {
        if !session.isPublished { return "Sin publicar" }
        guard let overview = session.overview else { return nil }
        let rows = overview.counts.values.reduce(0, +)
        guard rows > 0 else { return nil }
        return "\(rows.formatted()) registros"
    }
}
