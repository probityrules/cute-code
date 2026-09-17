import sharp from "sharp";

const iconBody = await fetch(
  "https://api.iconify.design/lucide.json?icons=workflow"
).then((r) => r.json());
const body = iconBody.icons.workflow.body.replaceAll("currentColor", "#f3efe6");

// Lucide icons are drawn in a 24×24 viewBox; scale into a padded tile.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="52" fill="#1f6b4f"/>
  <g transform="translate(48 48) scale(6.6666667)">${body}</g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile("media/icon.png");
const meta = await sharp("media/icon.png").metadata();
console.log(`wrote media/icon.png ${meta.width}x${meta.height}`);
