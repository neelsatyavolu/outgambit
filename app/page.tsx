import { SetupForm } from "@/components/SetupForm";

export default function HomePage() {
  return (
    <>
      <h1 className="display">Play a machine</h1>
      <p className="lede">
        Pick a model, set the clock and play a full game of chess against it. Everyone gets two games a day.
      </p>
      <SetupForm />
    </>
  );
}
