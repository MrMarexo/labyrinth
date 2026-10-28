import { getTranslations } from "next-intl/server";

import { MazeList } from "~/components/editor/maze-list";
import { NewMazeForm } from "~/components/editor/new-maze-form";
import { SignUpNotice } from "~/components/sign-up-notice";
import { api } from "~/trpc/server";

/** Open to everyone, but the library is a member's: others get the notice. */
export default async function LabyrinthsPage() {
  const t = await getTranslations("labyrinths");
  const viewer = await api.viewer.get();

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-3xl">{t("title")}</h1>
      {viewer.kind === "member" ? (
        <>
          <NewMazeForm />
          <MazeList />
        </>
      ) : (
        <SignUpNotice kind="labyrinths" />
      )}
    </main>
  );
}
