import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const publicModuleImports = {
  // Explicit public client/server entries keep Node adapters out of UI bundles.
  group: ["@/modules/*/**", "!@/modules/enquiries/client", "!@/modules/enquiries/domain", "!@/modules/quotes/client", "!@/modules/quotes/server", "!@/modules/bookings/client", "!@/modules/bookings/server", "!@/modules/operations/client", "!@/modules/admin-access/client", "!@/modules/admin-access/server", "!@/modules/customers/client", "!@/modules/customers/server", "!@/modules/admin-dashboard/client", "!@/modules/admin-dashboard/server"],
  message: "Import through a declared public index, client or server entry; use relative imports inside the same module.",
};

const innerLayerImports = {
  group: [
    "react", "react/**", "react-dom", "react-dom/**", "next", "next/**",
    "lucide-react", "@supabase/**", "@/shared/ui/**",
    "../infrastructure/**", "../presentation/**", "../../infrastructure/**", "../../presentation/**",
  ],
  message: "Domain and application code must not depend on UI, frameworks or concrete infrastructure.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [publicModuleImports] }],
    },
  },
  {
    files: ["src/modules/*/{domain,application}/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [publicModuleImports, innerLayerImports] }],
    },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@/modules/**", "../modules/**", "../../modules/**"],
          message: "Shared code must not depend on business modules.",
        }],
      }],
    },
  },
  globalIgnores([".next/**", ".local/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
