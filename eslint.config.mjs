import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const publicModuleImports = {
  // The explicitly declared UI entry avoids pulling the booking Node adapters
  // into client bundles; other internal module paths remain restricted.
  group: ["@/modules/*/**", "!@/modules/bookings/client"],
  message: "Import through a public index or the declared bookings/client UI entry; use relative imports inside the same module.",
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
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
