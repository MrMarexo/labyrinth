import { useTranslations } from "next-intl";

import { MazeList } from "~/components/editor/maze-list";
import { NewMazeForm } from "~/components/editor/new-maze-form";

export default function LabyrinthsPage() {
  const t = useTranslations("labyrinths");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-3xl font-bold">{t("title")}</h1>
      <NewMazeForm />
      <MazeList />
    </main>
  );
}
