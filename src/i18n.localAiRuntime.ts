import type { AppLanguage } from '@shared/types';
import { getActiveLang, resolveTranslation } from './i18n';

// Scoped messages use the desktop resolver; every message requires every locale.
const MESSAGES = {
  "Motor no instalado": {
    "en": "Engine not installed", "fr": "Moteur non installé", "de": "Engine nicht installiert", "pt": "Motor não instalado", "pt-BR": "Motor não instalado", "it": "Motore non installato", "tr": "Motor yüklü değil", "zh-CN": "引擎未安装"
  },
  "Motor instalado": {
    "en": "Engine installed", "fr": "Moteur installé", "de": "Engine installiert", "pt": "Motor instalado", "pt-BR": "Motor instalado", "it": "Motore installato", "tr": "Motor yüklü", "zh-CN": "引擎已安装"
  },
  "Cargando modelo…": {
    "en": "Loading model…", "fr": "Chargement du modèle…", "de": "Modell wird geladen…", "pt": "A carregar modelo…", "pt-BR": "Carregando modelo…", "it": "Caricamento del modello…", "tr": "Model yükleniyor…", "zh-CN": "正在加载模型…"
  },
  "Modelo listo": {
    "en": "Model ready", "fr": "Modèle prêt", "de": "Modell bereit", "pt": "Modelo pronto", "pt-BR": "Modelo pronto", "it": "Modello pronto", "tr": "Model hazır", "zh-CN": "模型已就绪"
  },
  "Calibración en segundo plano; tu solicitud tiene prioridad.": {
    "en": "Background calibration; your request takes priority.",
    "fr": "Étalonnage en arrière-plan ; votre requête est prioritaire.",
    "de": "Kalibrierung im Hintergrund; Ihre Anfrage hat Vorrang.",
    "pt": "Calibração em segundo plano; o seu pedido tem prioridade.",
    "pt-BR": "Calibração em segundo plano; sua solicitação tem prioridade.",
    "it": "Calibrazione in background; la tua richiesta ha la priorità.",
    "tr": "Arka planda kalibrasyon yapılıyor; isteğiniz önceliklidir.",
    "zh-CN": "正在后台校准；您的请求优先。"
  },
  "Error al iniciar el modelo": {
    "en": "Model startup failed", "fr": "Échec du démarrage du modèle", "de": "Modellstart fehlgeschlagen", "pt": "Falha ao iniciar o modelo", "pt-BR": "Falha ao iniciar o modelo", "it": "Avvio del modello non riuscito", "tr": "Model başlatılamadı", "zh-CN": "模型启动失败"
  },
  "GPU detectada: {devices}": {
    "en": "Detected GPU: {devices}", "fr": "GPU détecté : {devices}", "de": "Erkannte GPU: {devices}", "pt": "GPU detetada: {devices}", "pt-BR": "GPU detectada: {devices}", "it": "GPU rilevata: {devices}", "tr": "Algılanan GPU: {devices}", "zh-CN": "检测到的 GPU：{devices}"
  },
  "Capas del modelo en GPU: {count}": {
    "en": "Model layers on GPU: {count}", "fr": "Couches du modèle sur le GPU : {count}", "de": "Modellschichten auf der GPU: {count}", "pt": "Camadas do modelo na GPU: {count}", "pt-BR": "Camadas do modelo na GPU: {count}", "it": "Livelli del modello sulla GPU: {count}", "tr": "GPU üzerindeki model katmanları: {count}", "zh-CN": "GPU 上的模型层数：{count}"
  },
  "El modelo se está ejecutando en CPU.": {
    "en": "The model is running on CPU.", "fr": "Le modèle fonctionne sur le CPU.", "de": "Das Modell wird auf der CPU ausgeführt.", "pt": "O modelo está a ser executado na CPU.", "pt-BR": "O modelo está sendo executado na CPU.", "it": "Il modello viene eseguito sulla CPU.", "tr": "Model CPU üzerinde çalışıyor.", "zh-CN": "模型正在 CPU 上运行。"
  },
  "El uso de GPU se comprueba al cargar el modelo.": {
    "en": "GPU usage is checked when the model loads.",
    "fr": "L’utilisation du GPU est vérifiée au chargement du modèle.",
    "de": "Die GPU-Nutzung wird beim Laden des Modells geprüft.",
    "pt": "A utilização da GPU é verificada ao carregar o modelo.",
    "pt-BR": "O uso da GPU é verificado ao carregar o modelo.",
    "it": "L’utilizzo della GPU viene verificato al caricamento del modello.",
    "tr": "GPU kullanımı model yüklenirken doğrulanır.",
    "zh-CN": "模型加载时将检查 GPU 使用情况。"
  },
  "El motor antiguo es solo CPU. Comprueba la actualización para habilitar una GPU compatible sin volver a descargar los modelos.": {
    "en": "The old engine is CPU-only. Check for an update to enable a compatible GPU without downloading the models again.",
    "fr": "L’ancien moteur utilise uniquement le CPU. Recherchez une mise à jour pour activer un GPU compatible sans télécharger à nouveau les modèles.",
    "de": "Die alte Engine unterstützt nur die CPU. Suchen Sie nach einem Update, um eine kompatible GPU zu aktivieren, ohne die Modelle erneut herunterzuladen.",
    "pt": "O motor antigo usa apenas a CPU. Procure uma atualização para ativar uma GPU compatível sem voltar a transferir os modelos.",
    "pt-BR": "O motor antigo usa apenas a CPU. Verifique se há uma atualização para ativar uma GPU compatível sem baixar os modelos novamente.",
    "it": "Il vecchio motore utilizza solo la CPU. Cerca un aggiornamento per abilitare una GPU compatibile senza scaricare nuovamente i modelli.",
    "tr": "Eski motor yalnızca CPU kullanır. Modelleri yeniden indirmeden uyumlu bir GPU’yu etkinleştirmek için güncellemeleri kontrol edin.",
    "zh-CN": "旧引擎仅支持 CPU。检查更新可启用兼容的 GPU，无需重新下载模型。"
  },
  "No se pudo activar una GPU compatible; se utilizará CPU.": {
    "en": "A compatible GPU could not be activated; CPU will be used.",
    "fr": "Aucun GPU compatible n’a pu être activé ; le CPU sera utilisé.",
    "de": "Eine kompatible GPU konnte nicht aktiviert werden; die CPU wird verwendet.",
    "pt": "Não foi possível ativar uma GPU compatível; será utilizada a CPU.",
    "pt-BR": "Não foi possível ativar uma GPU compatível; a CPU será utilizada.",
    "it": "Non è stato possibile attivare una GPU compatibile; verrà utilizzata la CPU.",
    "tr": "Uyumlu bir GPU etkinleştirilemedi; CPU kullanılacak.",
    "zh-CN": "无法启用兼容的 GPU；将使用 CPU。"
  },
  "El arranque con GPU falló; se ha reintentado con CPU.": {
    "en": "GPU startup failed; startup was retried on CPU.",
    "fr": "Le démarrage sur GPU a échoué ; une nouvelle tentative a été effectuée sur CPU.",
    "de": "Der GPU-Start ist fehlgeschlagen; der Start wurde auf der CPU wiederholt.",
    "pt": "O arranque com GPU falhou; foi efetuada uma nova tentativa com CPU.",
    "pt-BR": "A inicialização com GPU falhou; uma nova tentativa foi feita com CPU.",
    "it": "L’avvio con GPU non è riuscito; è stato ritentato con CPU.",
    "tr": "GPU ile başlatma başarısız oldu; CPU ile yeniden denendi.",
    "zh-CN": "GPU 启动失败；已尝试使用 CPU 重新启动。"
  },
  "Diagnóstico local": {
    "en": "Local diagnostics", "fr": "Diagnostic local", "de": "Lokale Diagnose", "pt": "Diagnóstico local", "pt-BR": "Diagnóstico local", "it": "Diagnostica locale", "tr": "Yerel tanılama", "zh-CN": "本地诊断"
  },
  "Comprobar/actualizar motor": {
    "en": "Check/update engine", "fr": "Vérifier/mettre à jour le moteur", "de": "Engine prüfen/aktualisieren", "pt": "Verificar/atualizar motor", "pt-BR": "Verificar/atualizar motor", "it": "Verifica/aggiorna motore", "tr": "Motoru kontrol et/güncelle", "zh-CN": "检查/更新引擎"
  },
  "Puede descargar motores; los modelos se conservan.": {
    "en": "May download engines; your models are kept.",
    "fr": "Peut télécharger des moteurs ; vos modèles sont conservés.",
    "de": "Lädt gegebenenfalls Engines herunter; Ihre Modelle bleiben erhalten.",
    "pt": "Pode transferir motores; os seus modelos são preservados.",
    "pt-BR": "Pode baixar motores; seus modelos são preservados.",
    "it": "Può scaricare motori; i tuoi modelli vengono conservati.",
    "tr": "Motorlar indirilebilir; modelleriniz korunur.",
    "zh-CN": "可能会下载引擎；已有模型将保留。"
  },
  "Cancelar descarga del motor": {
    "en": "Cancel engine download", "fr": "Annuler le téléchargement du moteur", "de": "Engine-Download abbrechen", "pt": "Cancelar transferência do motor", "pt-BR": "Cancelar download do motor", "it": "Annulla download del motore", "tr": "Motor indirmesini iptal et", "zh-CN": "取消引擎下载"
  }
} as const satisfies Record<string, Record<Exclude<AppLanguage, 'es'>, string>>;

export type LocalRuntimeTextKey = keyof typeof MESSAGES;
const languages = ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN'] as const;
export const LOCAL_RUNTIME_TRANSLATIONS = Object.fromEntries(languages.map((language) => [
  language, Object.fromEntries(Object.entries(MESSAGES).map(([key, values]) => [key, values[language]])),
])) as Record<Exclude<AppLanguage, 'es'>, Record<LocalRuntimeTextKey, string>>;

export function runtimeText(key: LocalRuntimeTextKey): string {
  return resolveTranslation(getActiveLang(), key, LOCAL_RUNTIME_TRANSLATIONS);
}
