/**
 * RecipeEngine — YAML-based workflow system for Soul skills.
 *
 * Inspired by Goose's Recipe system: YAML files with parameters,
 * validation, conditional activation, and sub-recipes.
 *
 * Replaces hard-coded skills in CLAUDE.md with versionable,
 * shareable, parametrizable recipe files.
 *
 * Recipe format:
 *   version: "1.0"
 *   title: "Recipe Name"
 *   description: "What it does"
 *   trigger: "slash-command-name"
 *   parameters: [{ key, type, required, default, description }]
 *   conditions: { files: ["glob"], state: { field: "value" } }
 *   instructions: "System prompt for the LLM"
 *   prompt: "Initial user message (supports {{ param }} templates)"
 *   extensions: [{ builtin: "name" }]
 *   sub_recipes: [{ name, path, values }]
 *
 * Community metadata (optional, backwards-compatible):
 *   author: "username"
 *   homepage: "https://github.com/..."
 *   tags: ["research", "automation"]
 *   license: "MIT"
 *   min_engine: "1.2.0"
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join, basename, dirname } from 'path';
import { parse as parseYaml } from 'yaml';

export class RecipeEngine {
  constructor(soulPath, { bus, llm } = {}) {
    this.soulPath = soulPath;
    this.bus = bus || null;
    this.llm = llm || null;
    this.recipes = new Map();
    this.recipeDirs = [
      resolve(soulPath, 'recipes'),           // Project recipes
      resolve(soulPath, 'recipes', 'community'), // Community-installed skills
      resolve(soulPath, 'seelen-protokoll', 'recipes'), // Protocol recipes
    ];
  }

  /**
   * Discover and load all recipes from recipe directories.
   */
  load() {
    this.recipes.clear();

    for (const dir of this.recipeDirs) {
      if (!existsSync(dir)) continue;

      // Hermes/Anthropic-Standard: SKILL.md mit YAML-Frontmatter + Markdown-Body wird
      // genauso behandelt wie eine .yaml-Recipe. So lassen sich Skills aus dem
      // agentskills.io-Ökosystem direkt via `git clone` reinziehen.
      const files = readdirSync(dir, { recursive: true })
        .filter(f =>
          f.endsWith('.yaml') ||
          f.endsWith('.yml') ||
          f === 'SKILL.md' ||
          f.endsWith('/SKILL.md') ||
          f.endsWith('\\SKILL.md')
        );

      for (const file of files) {
        try {
          const fullPath = resolve(dir, file);
          const content = readFileSync(fullPath, 'utf8');
          let recipe;
          if (file.endsWith('SKILL.md')) {
            recipe = this._parseSkillMd(content);
            if (!recipe) {
              console.warn(`[Recipes] Skipping ${file}: no valid frontmatter`);
              continue;
            }
          } else {
            recipe = parseYaml(content);
          }

          if (!recipe || !recipe.title) {
            console.warn(`[Recipes] Skipping ${file}: no title`);
            continue;
          }

          const id = recipe.trigger || basename(file, '.yaml').replace(/\.(yml|md)$/, '');
          recipe._path = fullPath;
          recipe._id = id;

          // Validate
          const errors = this.validate(recipe);
          if (errors.length > 0) {
            console.warn(`[Recipes] ${file} has validation errors:`, errors);
            continue;
          }

          this.recipes.set(id, recipe);
        } catch (err) {
          console.warn(`[Recipes] Failed to load ${file}:`, err.message);
        }
      }
    }

    console.log(`  Recipes:   ${this.recipes.size} loaded`);
    return this;
  }

  /**
   * Parse a SKILL.md (Hermes/agentskills.io-Standard):
   *   ---
   *   name: my-skill
   *   description: ...
   *   version: "1.0"
   *   ---
   *   <Markdown-Body wird zu instructions>
   * Mapping: name → trigger, description → description, Body → instructions.
   */
  _parseSkillMd(content) {
    const m = content.match(/^---\s*\n([\s\S]+?)\n---\s*\n([\s\S]*)$/);
    if (!m) return null;
    let fm;
    try { fm = parseYaml(m[1]); } catch { return null; }
    if (!fm || typeof fm !== 'object') return null;
    const body = (m[2] || '').trim();
    return {
      version: fm.version || '1.0',
      title: fm.title || fm.name || 'Untitled Skill',
      description: fm.description || '',
      trigger: fm.trigger || fm.name || null,
      instructions: body || fm.instructions || '',
      prompt: fm.prompt || '',
      author: fm.author,
      homepage: fm.homepage,
      tags: fm.tags,
      license: fm.license,
      min_engine: fm.min_engine,
      settings: fm.settings,
      auto_generated: fm.auto_generated,
      _source: 'skill-md',
    };
  }

  /**
   * Validate a recipe object. Returns array of error strings.
   *
   * Community metadata fields (author, homepage, tags, license, min_engine)
   * are optional and always accepted without error.
   */
  validate(recipe) {
    const errors = [];

    if (!recipe.version) errors.push('Missing version');
    if (!recipe.title) errors.push('Missing title');
    if (!recipe.prompt && !recipe.instructions) {
      errors.push('Must have either prompt or instructions');
    }

    // Validate optional community metadata types (if present)
    if (recipe.author !== undefined && typeof recipe.author !== 'string') {
      errors.push('author must be a string');
    }
    if (recipe.homepage !== undefined && typeof recipe.homepage !== 'string') {
      errors.push('homepage must be a string');
    }
    if (recipe.tags !== undefined && !Array.isArray(recipe.tags)) {
      errors.push('tags must be an array');
    }
    if (recipe.license !== undefined && typeof recipe.license !== 'string') {
      errors.push('license must be a string');
    }
    if (recipe.min_engine !== undefined && typeof recipe.min_engine !== 'string') {
      errors.push('min_engine must be a string');
    }

    if (recipe.parameters) {
      for (const param of recipe.parameters) {
        if (!param.key) errors.push(`Parameter missing key`);
        if (param.required && param.default !== undefined) {
          // Not an error, but note: required params with defaults are optional
        }
        if (param.type === 'file' && param.default) {
          errors.push(`File parameters cannot have defaults (${param.key})`);
        }
      }

      // Check template variables match parameters
      const templateVars = this._extractTemplateVars(recipe.prompt || '');
      const instructionVars = this._extractTemplateVars(recipe.instructions || '');
      const allVars = new Set([...templateVars, ...instructionVars]);
      const paramKeys = new Set(recipe.parameters.map(p => p.key));

      for (const v of allVars) {
        if (!paramKeys.has(v)) {
          errors.push(`Template variable {{ ${v} }} has no matching parameter`);
        }
      }
    }

    return errors;
  }

  /**
   * Extract {{ variable }} names from a template string.
   */
  _extractTemplateVars(template) {
    const matches = template.matchAll(/\{\{\s*(\w+)\s*\}\}/g);
    return [...matches].map(m => m[1]);
  }

  /**
   * Render a template string with parameter values.
   */
  _renderTemplate(template, values) {
    if (!template) return '';
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
      return values[key] !== undefined ? String(values[key]) : match;
    });
  }

  /**
   * Check if a recipe's conditions are met.
   */
  checkConditions(recipe) {
    if (!recipe.conditions) return true;

    // File conditions: check if matching files exist
    if (recipe.conditions.files) {
      const { globSync } = require('glob');
      for (const pattern of recipe.conditions.files) {
        const matches = globSync(pattern, { cwd: this.soulPath });
        if (matches.length === 0) return false;
      }
    }

    // State conditions: check allostatic field or other state
    if (recipe.conditions.state) {
      // Placeholder — would check against actual field state
      // e.g., { arousal: ">0.5" } means only activate when aroused
    }

    return true;
  }

  /**
   * Execute a recipe by ID with given parameter values.
   * Returns the built prompt + instructions for the LLM.
   */
  async execute(recipeId, values = {}) {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) {
      throw new Error(`Recipe '${recipeId}' not found. Available: ${[...this.recipes.keys()].join(', ')}`);
    }

    // Check conditions
    if (!this.checkConditions(recipe)) {
      throw new Error(`Recipe '${recipeId}' conditions not met`);
    }

    // Validate required parameters
    if (recipe.parameters) {
      for (const param of recipe.parameters) {
        if (param.required && values[param.key] === undefined && param.default === undefined) {
          throw new Error(`Missing required parameter: ${param.key}`);
        }
        // Apply defaults
        if (values[param.key] === undefined && param.default !== undefined) {
          values[param.key] = param.default;
        }
      }
    }

    // Render templates
    const instructions = this._renderTemplate(recipe.instructions, values);
    const prompt = this._renderTemplate(recipe.prompt, values);

    // Log execution
    if (this.bus) {
      this.bus.safeEmit('recipe.executed', {
        recipeId,
        title: recipe.title,
        values,
        source: 'recipe-engine'
      });
    }

    // If LLM is available and we have both instructions + prompt, execute directly
    if (this.llm && instructions && prompt) {
      try {
        const response = await this.llm.generate(instructions, [], prompt, {
          maxTokens: recipe.settings?.max_tokens || 4096,
          temperature: recipe.settings?.temperature || 0.7,
        });
        return {
          recipe: recipe.title,
          instructions,
          prompt,
          response,
          executed: true
        };
      } catch (err) {
        console.error(`[Recipes] Execution error for ${recipeId}:`, err.message);
        return {
          recipe: recipe.title,
          instructions,
          prompt,
          error: err.message,
          executed: false
        };
      }
    }

    // Otherwise return the built prompt for external execution
    return {
      recipe: recipe.title,
      instructions,
      prompt,
      executed: false
    };
  }

  /**
   * List all available recipes with metadata.
   */
  list() {
    return [...this.recipes.entries()].map(([id, r]) => ({
      id,
      title: r.title,
      description: r.description || '',
      trigger: r.trigger || id,
      parameters: (r.parameters || []).map(p => ({
        key: p.key,
        type: p.type || 'string',
        required: p.required || false,
        description: p.description || ''
      })),
      conditions: r.conditions || null,
      path: r._path,
      // Community metadata (optional)
      ...(r.author && { author: r.author }),
      ...(r.homepage && { homepage: r.homepage }),
      ...(r.tags && { tags: r.tags }),
      ...(r.license && { license: r.license }),
      ...(r.min_engine && { min_engine: r.min_engine }),
    }));
  }

  /**
   * Get a recipe by ID.
   */
  get(recipeId) {
    return this.recipes.get(recipeId) || null;
  }
}
