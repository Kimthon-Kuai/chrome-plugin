(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Hero bilingual line swap
  const en = document.querySelector(".line-en");
  const zh = document.querySelector(".line-zh");
  if (en && zh && !reduceMotion) {
    let showZh = false;
    const tick = () => {
      showZh = !showZh;
      en.classList.toggle("is-active", !showZh);
      zh.classList.toggle("is-active", showZh);
    };
    setInterval(tick, 3200);
  } else if (en) {
    en.classList.add("is-active");
  }

  // Scroll reveal
  const nodes = document.querySelectorAll(".reveal");
  if (!nodes.length) return;

  if (reduceMotion || !("IntersectionObserver" in window)) {
    nodes.forEach((n) => n.classList.add("is-in"));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
  );

  nodes.forEach((n) => io.observe(n));
})();
