// Interface language. English is the source; Turkish is applied to the rendered page by replacing whole
// interface strings (text, placeholder, title, aria-label). Chat messages, terminals and the editor are never touched.
export type Lang = "en" | "tr";
const KEY = "dispatch.lang";

const TR: Record<string, string> = {
  // Navigation
  "Home": "Ana sayfa", "Chat": "Sohbet", "Operation": "Operasyon", "Overview": "Genel bakış", "Messages": "Mesajlar", "Tasks": "Görevler",
  "Templates": "Şablonlar", "Agent templates": "Ajan şablonları", "Providers": "Sağlayıcılar", "Extensions": "Uzantılar", "Tools": "Araçlar", "Plugins": "Eklentiler",
  "Brain": "Beyin", "Skills": "Yetenekler", "Memory": "Hafıza", "Boss memory": "Boss hafızası", "Share": "Paylaş", "Export and import": "Dışa ve içe aktar",
  "Servers": "Sunucular", "Settings": "Ayarlar", "Terminal": "Terminal", "Files": "Dosyalar", "Team": "Ekip", "Teams": "Ekipler",
  // Settings
  "General": "Genel", "Workspace": "Çalışma alanı", "Change": "Değiştir", "Language": "Dil", "Keyboard shortcuts": "Klavye kısayolları",
  "Interface language. Chats and agent replies are not translated.": "Arayüz dili. Sohbetler ve ajan yanıtları çevrilmez.",
  "Voice": "Ses", "Other computers": "Diğer bilgisayarlar", "Connect to a computer": "Bir bilgisayara bağlan",
  // Common actions
  "Save": "Kaydet", "Cancel": "İptal", "Close": "Kapat", "Remove": "Kaldır", "Delete": "Sil", "Edit": "Düzenle", "Add": "Ekle",
  "Create": "Oluştur", "Start": "Başlat", "Stop": "Durdur", "Restart": "Yeniden başlat", "Resume": "Devam et", "Send": "Gönder",
  "Open": "Aç", "Back": "Geri", "Next": "İleri", "Done": "Bitti", "Retry": "Tekrar dene", "Copy": "Kopyala", "Copied": "Kopyalandı",
  "Search": "Ara", "Refresh": "Yenile", "Install": "Kur", "Uninstall": "Kaldır", "Update": "Güncelle", "Enable": "Aç", "Disable": "Kapat",
  "Connect": "Bağlan", "Disconnect": "Bağlantıyı kes", "Import": "İçe aktar", "Export": "Dışa aktar", "Rename": "Yeniden adlandır",
  "Dismiss": "Kapat", "Choose": "Seç", "Browse": "Gözat", "Test": "Test et", "Apply": "Uygula", "Reset": "Sıfırla", "Clear": "Temizle",
  "Loading…": "Yükleniyor…", "Checking…": "Kontrol ediliyor…", "Saving…": "Kaydediliyor…", "Working": "Çalışıyor", "Idle": "Boşta",
  "Stopped": "Durduruldu", "Running": "Çalışıyor", "Ready": "Hazır", "Error": "Hata", "Unknown": "Bilinmiyor", "None": "Yok",
  "On": "Açık", "Off": "Kapalı", "Yes": "Evet", "No": "Hayır", "Default": "Varsayılan", "Auto": "Otomatik", "Custom": "Özel",
  // Home / operations
  "New chat": "Yeni sohbet", "New operation": "Yeni operasyon", "Start operation": "Operasyonu başlat", "Previous operations": "Önceki operasyonlar",
  "Resume this operation?": "Bu operasyona devam edilsin mi?", "Current agents will stop.": "Mevcut ajanlar duracak.",
  "Resume this operation": "Bu operasyona devam et", "Switch workspace?": "Çalışma alanı değiştirilsin mi?", "Switch": "Değiştir",
  "Enlist": "Ajan ekle", "Enlist agent": "Ajan ekle", "Dismiss agent": "Ajanı çıkar", "Save as template": "Şablon olarak kaydet",
  "Template name": "Şablon adı", "Chats": "Sohbetler", "Agents": "Ajanlar", "Boss": "Boss", "Change boss": "Boss'u değiştir",
  // Providers
  "Signed out": "Oturum kapalı", "Installed": "Kurulu", "Not installed": "Kurulu değil", "Not found on this computer": "Bu bilgisayarda bulunamadı",
  "Sign in": "Giriş yap", "Sign out": "Çıkış yap", "Open to sign in": "Giriş için aç", "Repair": "Onar", "Check for updates": "Güncellemeleri denetle",
  "Refresh models": "Modelleri yenile", "Show details": "Ayrıntıları göster", "Hide details": "Ayrıntıları gizle", "Up to date": "Güncel",
  "Custom AI": "Özel AI", "Provider name": "Sağlayıcı adı", "Server URL": "Sunucu adresi", "Model ID": "Model kimliği", "API key": "API anahtarı",
  "Icon": "Simge", "Save provider": "Sağlayıcıyı kaydet", "Test connection": "Bağlantıyı test et", "Detected": "Bulunan",
  "Saved globally": "Tüm çalışma alanları için kaydedildi", "Remove this provider?": "Bu sağlayıcı kaldırılsın mı?",
  "Search icons…": "Simge ara…", "No icons found.": "Simge bulunamadı.", "Only for hosted servers": "Yalnızca uzak sunucular için",
  "Saved · leave empty to keep": "Kayıtlı · korumak için boş bırak", "Local": "Yerel", "Remote": "Uzak", "Key": "Anahtar",
  // Tabs
  "Open folder…": "Klasör aç…", "New tab without a folder": "Klasörsüz yeni sekme", "Start without a folder": "Klasör seçmeden başla", "Click to load the scene": "Sahneyi yüklemek için tıkla", "Press a key": "Bir tuşa bas", "New tab": "Yeni sekme", "Close tab": "Sekmeyi kapat", "Open a project in a new tab": "Projeyi yeni sekmede aç",
  "Open a folder": "Bir klasör aç", "Open folder": "Klasör aç", "Recent workspaces": "Son çalışma alanları", "Projects": "Projeler",
  // Templates
  "Name": "Ad", "Description": "Açıklama", "Provider": "Sağlayıcı", "Model": "Model", "Effort": "Efor", "Role": "Rol",
  "Approvals": "Onaylar", "New template": "Yeni şablon", "Duplicate": "Çoğalt",
};

let lang: Lang = (() => { try { return localStorage.getItem(KEY) === "tr" ? "tr" : "en"; } catch { return "en"; } })();
export const getLang = () => lang;
export function setLang(next: Lang) { try { localStorage.setItem(KEY, next); } catch {} location.reload(); }

const SKIP = ".xterm, .monaco-editor, .md, .msg, .message, .bubble, pre, code, textarea, [contenteditable], [data-no-i18n]";
const ATTRS = ["placeholder", "title", "aria-label"];

function swap(value: string | null): string | null {
  // Never return an unchanged value: setting it again fires the observer again, forever (Model, Terminal, Boss).
  if (!value) return null;
  const trimmed = value.trim(); const hit = TR[trimmed];
  return hit && hit !== trimmed ? value.replace(trimmed, hit) : null;
}
function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement; if (!parent || parent.closest(SKIP)) return;
    const next = swap(node.nodeValue); if (next && next !== node.nodeValue) node.nodeValue = next;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element; if (el.closest(SKIP)) return;
  for (const a of ATTRS) { const next = swap(el.getAttribute(a)); if (next) el.setAttribute(a, next); }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE) { const e = n as Element; if (e.matches(SKIP)) continue; for (const a of ATTRS) { const next = swap(e.getAttribute(a)); if (next) e.setAttribute(a, next); } }
    else translateNode(n);
  }
}
export function startI18n() {
  document.documentElement.lang = lang;
  if (lang === "en") return;
  translateNode(document.body);
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === "characterData") translateNode(r.target);
      else if (r.type === "attributes" && r.target instanceof Element && r.attributeName && ATTRS.includes(r.attributeName)) { const next = swap(r.target.getAttribute(r.attributeName)); if (next) r.target.setAttribute(r.attributeName, next); }
      else r.addedNodes.forEach(translateNode);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
