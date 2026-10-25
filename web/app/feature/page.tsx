// /feature: the feedback form (app/feedback), with a feature chosen.
import { redirect } from "next/navigation";

export default function Go() {
  redirect("/feedback?kind=feature");
}
