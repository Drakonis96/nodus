import type { AppLanguage } from '@shared/types';
import { normalizeUiLanguage } from '@shared/uiLanguage';
import { EN } from '../i18n.en';
import { FR } from '../i18n.fr';
import { DE } from '../i18n.de';
import { PT } from '../i18n.pt';
import { PT_BR } from '../i18n.pt-BR';
import { IT } from '../i18n.it';
import { TR } from '../i18n.tr';

/**
 * Server Web uses the same translation tables as Desktop.  This used to be a
 * Spanish-only stub, which meant shared views silently ignored the user's
 * portable interface preference.  Keeping the adapter preserves the server
 * build boundary while making all eight supported locales available.
 *
 * The small local table covers the native Server settings shell's labels that
 * are intentionally not part of Desktop's source catalogue.  Shared labels
 * continue through the complete Desktop catalogue and its English fallback.
 */
const SERVER_WEB_TRANSLATIONS: Partial<Record<AppLanguage, Record<string, string>>> = {
  en: {
    'Ajustes': 'Settings', 'Servidor': 'Server', 'Proveedores': 'Providers', 'Modelos IA': 'AI models',
    'Biblioteca': 'Library', 'Texto y OCR': 'Text & OCR', Interfaz: 'Interface', Integraciones: 'Integrations',
    'Nodus Browser': 'Nodus Browser', 'Tutoriales': 'Tutorials', 'Copia de seguridad': 'Backup',
    'Acerca de': 'About', Actualizaciones: 'Updates', 'Busca un ajuste o entra por una sección temática.': 'Search for a setting or open a focused section.',
    'Buscar en ajustes…': 'Search settings…', 'Idioma de interfaz': 'Interface language', 'Idioma de prompts': 'Prompt language',
    'Guardar interfaz': 'Save interface', 'Guardar modelos': 'Save models', 'Guardando…': 'Saving…',
    'Cargando ajustes…': 'Loading settings…', 'Secciones de ajustes': 'Settings sections',
    'No hay ajustes que coincidan con la búsqueda.': 'No settings match your search.',
    'Proveedores de IA y modelos': 'AI providers and models', 'Modelos de IA': 'AI models',
    'Modelos favoritos para los selectores independientes': 'Favourite models for independent selectors',
    'Configuración': 'Configuration', Básica: 'Basic', Avanzada: 'Advanced',
    'Modelo general de texto': 'General text model', 'Sin asignar': 'Unassigned', pendiente: 'pending',
    'Tema': 'Theme', Sistema: 'System', Oscuro: 'Dark', Claro: 'Light',
    'Escala de interfaz': 'Interface scale', 'Fuente accesible': 'Accessible font',
    'Alto contraste': 'High contrast', 'Reducir movimiento': 'Reduce motion',
    'Modo de lectura enfocada': 'Focused reading mode',
    'Nodus Server': 'Nodus Server', 'Nuevo vault': 'New vault', 'Vaults del servidor': 'Server vaults',
    Nombre: 'Name', Tipo: 'Type', Descripción: 'Description', 'Crear vault': 'Create vault',
    Usuarios: 'Users', Dispositivos: 'Devices', 'Usuarios y acceso': 'Users and access',
    Dispositivo: 'Device', 'Último uso': 'Last used', Nunca: 'Never', Revocar: 'Revoke',
    Correo: 'Email', 'Contraseña temporal': 'Temporary password', 'Vault inicial': 'Initial vault',
    Rol: 'Role', Lectura: 'Read', Escritura: 'Write', Propietario: 'Owner',
    'Crear cuenta': 'Create account', 'Mi cuenta': 'My account', 'Cuenta activa': 'Active account',
    'Contraseña actual': 'Current password', 'Nueva contraseña': 'New password',
    'Repetir contraseña': 'Repeat password', 'Cambiar contraseña': 'Change password', 'Cerrar sesión': 'Sign out',
    'Nativo del servidor': 'Server-native', Editable: 'Editable', 'Sin publicar': 'Not published',
    'Conectar Desktop': 'Connect Desktop', 'Código de conexión': 'Connection code', Caduca: 'Expires',
    'Investigación': 'Research', Genealogía: 'Genealogy', Prosopografía: 'Prosopography',
    Testimonios: 'Testimonies', 'Fuentes primarias': 'Primary sources', Estudio: 'Study',
    Docencia: 'Teaching', 'Base de datos': 'Database',
    'Biblioteca publicada': 'Published library', 'Vaults disponibles': 'Available vaults', Privacidad: 'Privacy',
    Protegida: 'Protected', 'Sincronización Zotero': 'Zotero synchronisation',
    'Extracción de texto y OCR': 'Text extraction and OCR', 'Texto publicado': 'Published text',
    'OCR de PDF': 'PDF OCR', 'Lectura nativa': 'Native reading', 'Gestionado por Desktop': 'Managed by Desktop',
    'Servidor MCP': 'MCP server', Compatible: 'Compatible',
    'Primeros pasos': 'Getting started', 'IA privada': 'Private AI',
    'Perfil portable': 'Portable profile', 'Última sincronización': 'Last synchronisation', Sincronizado: 'Synchronised', Pendiente: 'Pending',
    'Acerca de Nodus Research': 'About Nodus Research', 'Versión Server': 'Server version',
    'Código fuente': 'Source code', 'Actualizaciones y novedades': 'Updates and what’s new', Canal: 'Channel',
    'Versión instalada': 'Installed version', 'Servidor administrado': 'Managed server',
  },
  fr: {
    'Ajustes': 'Paramètres', 'Servidor': 'Serveur', 'Proveedores': 'Fournisseurs', 'Modelos IA': 'Modèles IA',
    'Biblioteca': 'Bibliothèque', 'Texto y OCR': 'Texte et OCR', Interfaz: 'Interface', Integraciones: 'Intégrations',
    'Tutoriales': 'Tutoriels', 'Copia de seguridad': 'Sauvegarde', 'Acerca de': 'À propos', Actualizaciones: 'Mises à jour',
    'Busca un ajuste o entra por una sección temática.': 'Recherchez un paramètre ou accédez à une section thématique.',
    'Buscar en ajustes…': 'Rechercher dans les paramètres…', 'Idioma de interfaz': 'Langue de l’interface', 'Idioma de prompts': 'Langue des prompts',
    'Guardar interfaz': 'Enregistrer l’interface', 'Guardar modelos': 'Enregistrer les modèles', 'Guardando…': 'Enregistrement…',
  },
  de: {
    'Ajustes': 'Einstellungen', 'Servidor': 'Server', 'Proveedores': 'Anbieter', 'Modelos IA': 'KI-Modelle',
    'Biblioteca': 'Bibliothek', 'Texto y OCR': 'Text & OCR', Interfaz: 'Oberfläche', Integraciones: 'Integrationen',
    'Tutoriales': 'Tutorials', 'Copia de seguridad': 'Sicherung', 'Acerca de': 'Über', Actualizaciones: 'Updates',
    'Busca un ajuste o entra por una sección temática.': 'Suchen Sie nach einer Einstellung oder öffnen Sie einen Themenbereich.',
    'Buscar en ajustes…': 'Einstellungen durchsuchen…', 'Idioma de interfaz': 'Sprache der Oberfläche', 'Idioma de prompts': 'Prompt-Sprache',
    'Guardar interfaz': 'Oberfläche speichern', 'Guardar modelos': 'Modelle speichern', 'Guardando…': 'Wird gespeichert…',
  },
  pt: {
    'Ajustes': 'Definições', 'Servidor': 'Servidor', 'Proveedores': 'Provedores', 'Modelos IA': 'Modelos de IA',
    'Biblioteca': 'Biblioteca', 'Texto y OCR': 'Texto e OCR', Interfaz: 'Interface', Integraciones: 'Integrações',
    'Tutoriales': 'Tutoriais', 'Copia de seguridad': 'Cópia de segurança', 'Acerca de': 'Sobre', Actualizaciones: 'Atualizações',
    'Busca un ajuste o entra por una sección temática.': 'Procure uma definição ou abra uma secção temática.',
    'Buscar en ajustes…': 'Pesquisar nas definições…', 'Idioma de interfaz': 'Idioma da interface', 'Idioma de prompts': 'Idioma dos prompts',
    'Guardar interfaz': 'Guardar interface', 'Guardar modelos': 'Guardar modelos', 'Guardando…': 'A guardar…',
  },
  'pt-BR': {
    'Ajustes': 'Configurações', 'Servidor': 'Servidor', 'Proveedores': 'Provedores', 'Modelos IA': 'Modelos de IA',
    'Biblioteca': 'Biblioteca', 'Texto y OCR': 'Texto e OCR', Interfaz: 'Interface', Integraciones: 'Integrações',
    'Tutoriales': 'Tutoriais', 'Copia de seguridad': 'Backup', 'Acerca de': 'Sobre', Actualizaciones: 'Atualizações',
    'Busca un ajuste o entra por una sección temática.': 'Pesquise uma configuração ou abra uma seção temática.',
    'Buscar en ajustes…': 'Pesquisar nas configurações…', 'Idioma de interfaz': 'Idioma da interface', 'Idioma de prompts': 'Idioma dos prompts',
    'Guardar interfaz': 'Salvar interface', 'Guardar modelos': 'Salvar modelos', 'Guardando…': 'Salvando…',
  },
  it: {
    'Ajustes': 'Impostazioni', 'Servidor': 'Server', 'Proveedores': 'Provider', 'Modelos IA': 'Modelli IA',
    'Biblioteca': 'Biblioteca', 'Texto y OCR': 'Testo e OCR', Interfaz: 'Interfaccia', Integraciones: 'Integrazioni',
    'Tutoriales': 'Tutorial', 'Copia de seguridad': 'Backup', 'Acerca de': 'Informazioni', Actualizaciones: 'Aggiornamenti',
    'Busca un ajuste o entra por una sección temática.': 'Cerca un’impostazione o apri una sezione tematica.',
    'Buscar en ajustes…': 'Cerca nelle impostazioni…', 'Idioma de interfaz': 'Lingua dell’interfaccia', 'Idioma de prompts': 'Lingua dei prompt',
    'Guardar interfaz': 'Salva interfaccia', 'Guardar modelos': 'Salva modelli', 'Guardando…': 'Salvataggio…',
  },
  tr: {
    'Ajustes': 'Ayarlar', 'Servidor': 'Sunucu', 'Proveedores': 'Sağlayıcılar', 'Modelos IA': 'Yapay zekâ modelleri',
    'Biblioteca': 'Kütüphane', 'Texto y OCR': 'Metin ve OCR', Interfaz: 'Arayüz', Integraciones: 'Entegrasyonlar',
    'Tutoriales': 'Eğitimler', 'Copia de seguridad': 'Yedekleme', 'Acerca de': 'Hakkında', Actualizaciones: 'Güncellemeler',
    'Busca un ajuste o entra por una sección temática.': 'Bir ayar arayın veya tematik bir bölüm açın.',
    'Buscar en ajustes…': 'Ayarlarda ara…', 'Idioma de interfaz': 'Arayüz dili', 'Idioma de prompts': 'İstem dili',
    'Guardar interfaz': 'Arayüzü kaydet', 'Guardar modelos': 'Modelleri kaydet', 'Guardando…': 'Kaydediliyor…',
  },
};

let active: AppLanguage = 'en';

type TranslationTables = Partial<Record<Exclude<AppLanguage, 'es'>, Record<string, string>>>;
const DESKTOP_TABLES: TranslationTables = { en: EN, fr: FR, de: DE, pt: PT, 'pt-BR': PT_BR, it: IT, tr: TR };

export function setActiveLang(language: AppLanguage): void {
  active = normalizeUiLanguage(language);
}
export function getActiveLang(): AppLanguage { return active; }
export function resolveTranslation(language: unknown, source: string, tables: TranslationTables = DESKTOP_TABLES): string {
  const normalized = normalizeUiLanguage(language);
  if (normalized === 'es') return source;
  return SERVER_WEB_TRANSLATIONS[normalized]?.[source] ?? tables[normalized]?.[source] ?? SERVER_WEB_TRANSLATIONS.en?.[source] ?? tables.en?.[source] ?? source;
}
export function t(source: string): string { return resolveTranslation(active, source); }
export function tx(source: string, variables: Record<string, string | number>): string {
  return Object.entries(variables).reduce((value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)), t(source));
}
export function tr(value: string): string { return t(value); }
export function errorText(error: unknown): string { return t(error instanceof Error ? error.message : String(error)); }
export function pick<T>(values: Partial<Record<AppLanguage, T>> & { es: T; en: T }): T { return values[active] ?? values.en; }
export function notificationLine(value: unknown, fallback: string | undefined): string {
  return typeof value === 'string' && value.trim() ? tr(value) : fallback ? t(fallback) : '';
}
