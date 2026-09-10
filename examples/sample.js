/**
 * Example file for trying Cute Code: Open Structure View.
 * Double-click a function declaration to expand; double-click a call to jump to its definition.
 */

import { readFile } from "fs";

function format(name) {
  return name.trim().toUpperCase();
}

function greet(name) {
  const
    greeting = "Hello, ",
    label = format(name);

  function emphasize(text) {
    return `**${text}**`;
  }

  const out = emphasize(label);
  return `${greeting}${out}`;
}

class Actor {
  ready() {
    return true;
  }
}

class Greeter extends Actor {
  constructor(prefix) {
    this.prefix = prefix;
  }

  say(name) {
    return greet(name);
  }

  shout(name) {
    return this.say(name);
  }
}

const load = (path) => readFile(path);

function main() {
  const g = new Greeter("hi");
  g.shout("world");
  load("./data.txt");
}

export { greet, main };
