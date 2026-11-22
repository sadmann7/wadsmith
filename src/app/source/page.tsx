import type { Metadata } from "next";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { StandaloneShell } from "@/components/standalone-shell";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Source and licences",
  description:
    "Source for the Doom engine Wadsmith runs, and the licences of everything in it.",
};

interface EngineInfo {
  woof: { version: string; commit: string; repository: string };
  freedoom: { version: string };
  licenses: string[];
}

const licenseNames: Record<string, string> = {
  "base64.txt": "base64",
  "compiler-rt.txt": "LLVM compiler-rt",
  "dlmalloc.txt": "dlmalloc",
  "emscripten.txt": "Emscripten runtime",
  "flick-stick.txt": "Flick stick",
  "gyro.txt": "Gyro aiming",
  "md5.txt": "MD5",
  "miniz.txt": "miniz",
  "musl.txt": "musl libc",
  "nano-bsp.txt": "nano BSP",
  "nuked-opl3.txt": "Nuked OPL3",
  "sdl3-yuv2rgb.txt": "SDL3 yuv2rgb",
  "sdl3.txt": "SDL3",
  "sha1.txt": "SHA-1",
  "spng.txt": "spng",
  "yyjson.txt": "yyjson",
};

const engineFiles = "/engine/";
const linkClass =
  "text-foreground underline decoration-muted-foreground/60 underline-offset-4 hover:decoration-foreground";

export default function SourcePage() {
  const engine = engineInfo();
  return (
    <StandaloneShell>
      <main className="grid max-w-[744px] gap-8 px-8 pt-10 pb-12 max-[760px]:px-4">
        <div className="grid gap-3">
          <h1 className="m-0 text-4xl font-bold">Source and licences</h1>
          <p className="m-0 text-base text-foreground">
            Wadsmith plays maps in Woof, a Doom engine released under the GNU
            General Public License, version 2 or later. Wadsmith itself is under
            the same licence, with its source on{" "}
            <a
              className={linkClass}
              href="https://github.com/sadmann7/wadsmith"
            >
              GitHub
            </a>
            . This page has the engine&apos;s source, every change Wadsmith
            makes to it, and the licences of everything built into it.
          </p>
        </div>
        {engine ? (
          <>
            <Section title="Engine source">
              <p className="m-0 text-base">
                <a
                  className={linkClass}
                  href={`${engineFiles}woof-source.tar.gz`}
                >
                  Download the engine source
                </a>
                <span className="text-muted-foreground">
                  {" "}
                  · Woof {engine.woof.version} at the commit Wadsmith builds,
                  its patch and the build scripts
                </span>
              </p>
              <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 font-mono text-xs">
                <dt className="text-muted-foreground">Upstream</dt>
                <dd className="m-0">
                  <a
                    className={linkClass}
                    href={`${engine.woof.repository}/tree/${engine.woof.commit}`}
                  >
                    fabiangreffrath/woof
                  </a>
                </dd>
                <dt className="text-muted-foreground">Commit</dt>
                <dd className="m-0 break-all">{engine.woof.commit}</dd>
                <dt className="text-muted-foreground">Licence</dt>
                <dd className="m-0">
                  <a
                    className={linkClass}
                    href={`${engineFiles}WOOF-LICENSE.txt`}
                  >
                    GNU GPL, version 2 or later
                  </a>
                </dd>
              </dl>
            </Section>
            <Section title="Game data">
              <p className="m-0 text-base">
                Levels use textures, sounds and monsters from{" "}
                <a className={linkClass} href="https://freedoom.github.io/">
                  Freedoom
                </a>{" "}
                {engine.freedoom.version}, under a{" "}
                <a
                  className={linkClass}
                  href={`${engineFiles}FREEDOOM-LICENSE.txt`}
                >
                  BSD licence
                </a>
                .
              </p>
            </Section>
            <Section title="Built into the engine">
              <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-1 p-0 text-sm max-[520px]:grid-cols-1">
                {engine.licenses.map((file) => (
                  <li key={file}>
                    <a
                      className={linkClass}
                      href={`${engineFiles}licenses/${file}`}
                    >
                      {licenseNames[file] ?? file.replace(/\.txt$/, "")}
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        ) : (
          <Alert role="status">
            The engine hasn&apos;t been built here. Run pnpm setup:engine.
          </Alert>
        )}
      </main>
    </StandaloneShell>
  );
}

// setup:engine writes this file, so the page always names the engine that ships.
function engineInfo(): EngineInfo | null {
  try {
    return JSON.parse(
      readFileSync(join(process.cwd(), "public/engine/engine.json"), "utf8"),
    ) as EngineInfo;
  } catch {
    return null;
  }
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="grid gap-3 border-t border-border pt-6">
      <h2 className="m-0 font-mono text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}
