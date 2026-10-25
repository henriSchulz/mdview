// /bug: the feedback form (app/feedback), with a bug chosen.
import { redirect } from "next/navigation";

export default function Go() {
  redirect("/feedback?kind=bug");
}
