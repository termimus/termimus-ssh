import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";
import { id } from "./locales/id";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", nativeName: "English" },
  { code: "id", label: "Indonesian", nativeName: "Bahasa Indonesia" },
] as const;

export type SupportedLanguage = "en" | "id";

export const resources = {
  en: { translation: en },
  id: { translation: id },
} as const;

// Read persisted language from localStorage if available
function getInitialLanguage(): SupportedLanguage {
  try {
    const raw = localStorage.getItem("termimus_settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.state?.language === "en" || parsed?.state?.language === "id") {
        return parsed.state.language;
      }
    }
  } catch {
    // fallback
  }
  return "en";
}

void i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false, // React already escapes values safely
  },
});

export default i18n;
