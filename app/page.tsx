import { Nav } from "./_components/Nav";
import { Hero } from "./_components/Hero";
import { Marquee } from "./_components/Marquee";
import { Format } from "./_components/Format";
import { Broadcast } from "./_components/Broadcast";
import { Requests } from "./_components/Requests";
import { Schedule } from "./_components/Schedule";
import { Mobile } from "./_components/Mobile";
import { Footer } from "./_components/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <Marquee />
      <Format />
      <Broadcast />
      <Requests />
      <Schedule />
      <Mobile />
      <Footer />
    </>
  );
}
