// A large mixed document for the performance probes: node gen-big.mjs LINES > file.md
// (deterministic; about one block in eight is a code block, a formula, a table or a list)
const want = Number(process.argv[2] || 5000);
const words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split(" ");
let seed = 7;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const sentence = (n) => Array.from({ length: n }, () => words[rnd(words.length)]).join(" ");
const out = [];
let lines = 0, i = 0;
const push = (block) => { out.push(block); lines += block.split("\n").length + 1; };
while (lines < want) {
  i++;
  const k = i % 16;
  if (i % 40 === 1) push(`## Section ${Math.ceil(i / 40)}`);
  else if (k === 3) push("```js\n" + Array.from({ length: 6 }, (_v, j) => `const v${j} = ${rnd(100)}; // ${sentence(3)}`).join("\n") + "\n```");
  else if (k === 7) push("$$\n\\int_0^{" + rnd(9) + "} x^" + (1 + rnd(4)) + " \\, dx = \\frac{a}{b}\n$$");
  else if (k === 11) push("| Name | Value | Note |\n|------|------:|------|\n" + Array.from({ length: 4 }, () => `| ${words[rnd(20)]} | ${rnd(1000)} | ${sentence(3)} |`).join("\n"));
  else if (k === 13) push(Array.from({ length: 5 }, (_v, j) => `- ${j % 2 ? "[ ] " : ""}${sentence(6)}`).join("\n"));
  else push(`${sentence(10)} **${sentence(2)}** ${sentence(8)} \`${words[rnd(20)]}\` ${sentence(9)} [${words[rnd(20)]}](https://example.com/${rnd(999)}) and $x_${rnd(9)}$.\n${sentence(18)}`);
}
process.stdout.write(out.join("\n\n") + "\n");
