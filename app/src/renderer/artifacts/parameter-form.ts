/**
 * ParameterForm renders a Galaxy-style configuration form from a form spec.
 *
 * Widgets supported: text, integer, float, boolean, select, file.
 * Groups render as <fieldset> with legend + description.
 * Widget labels + help text styled for biologist readability.
 */

export interface FormParameter {
  name: string;
  type: "text" | "integer" | "float" | "boolean" | "select" | "file";
  label: string;
  help: string;
  value: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  fileFilter?: string;
  usedBy?: string[];
}

export interface ParameterGroup {
  title: string;
  description: string;
  params: FormParameter[];
}

export interface ParameterFormSpec {
  planId: string;
  title: string;
  description: string;
  groups: ParameterGroup[];
}

export class ParameterForm {
  private container: HTMLElement;
  private spec: ParameterFormSpec | null = null;
  private currentValues = new Map<string, string | number | boolean>();
  private disabled = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  render(spec: ParameterFormSpec): void {
    // Preserve any values already edited before re-rendering
    const preserved = new Map(this.currentValues);

    this.spec = spec;
    this.currentValues.clear();

    this.container.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.className = "param-header";
    const title = document.createElement("h2");
    title.className = "param-title";
    title.textContent = spec.title;
    const desc = document.createElement("p");
    desc.className = "param-desc";
    desc.textContent = spec.description;
    header.appendChild(title);
    header.appendChild(desc);
    this.container.appendChild(header);

    // Groups
    for (const group of spec.groups) {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "param-group";

      const legend = document.createElement("legend");
      legend.textContent = group.title;
      fieldset.appendChild(legend);

      if (group.description) {
        const gdesc = document.createElement("p");
        gdesc.className = "param-group-desc";
        gdesc.textContent = group.description;
        fieldset.appendChild(gdesc);
      }

      for (const param of group.params) {
        // If we had a value from a previous render, use it; otherwise use spec default
        const existing = preserved.get(param.name);
        const initialValue = existing !== undefined ? existing : param.value;
        this.currentValues.set(param.name, initialValue);

        const field = this.renderField(param, initialValue);
        fieldset.appendChild(field);
      }

      this.container.appendChild(fieldset);
    }

    if (this.disabled) this.setDisabled(true);
  }

  private renderField(param: FormParameter, value: string | number | boolean): HTMLElement {
    const field = document.createElement("div");
    field.className = "param-field";

    const label = document.createElement("label");
    label.className = "param-label";
    label.htmlFor = `param-${param.name}`;
    label.textContent = param.label;
    field.appendChild(label);

    let widget: HTMLElement;
    switch (param.type) {
      case "text":
        widget = this.renderText(param, value as string);
        break;
      case "integer":
        widget = this.renderNumber(param, value as number, true);
        break;
      case "float":
        widget = this.renderNumber(param, value as number, false);
        break;
      case "boolean":
        widget = this.renderBoolean(param, value as boolean);
        break;
      case "select":
        widget = this.renderSelect(param, value as string);
        break;
      case "file":
        widget = this.renderFile(param, value as string);
        break;
      default:
        widget = document.createElement("span");
        widget.textContent = `(unsupported type: ${(param as { type: string }).type})`;
    }
    field.appendChild(widget);

    if (param.help) {
      const help = document.createElement("div");
      help.className = "param-help";
      help.textContent = param.help;
      field.appendChild(help);
    }

    return field;
  }

  private renderText(param: FormParameter, value: string): HTMLElement {
    const input = document.createElement("input");
    input.type = "text";
    input.id = `param-${param.name}`;
    input.className = "param-input";
    input.value = String(value ?? "");
    input.addEventListener("input", () => {
      this.currentValues.set(param.name, input.value);
    });
    return input;
  }

  private renderNumber(param: FormParameter, value: number, integer: boolean): HTMLElement {
    const input = document.createElement("input");
    input.type = "number";
    input.id = `param-${param.name}`;
    input.className = "param-input param-number";
    input.value = String(value ?? 0);
    if (integer) {
      input.step = "1";
    } else if (param.step !== undefined) {
      input.step = String(param.step);
    } else {
      input.step = "any";
    }
    if (param.min !== undefined) input.min = String(param.min);
    if (param.max !== undefined) input.max = String(param.max);
    input.addEventListener("input", () => {
      const raw = input.value;
      if (raw === "") {
        this.currentValues.set(param.name, integer ? 0 : 0.0);
      } else {
        this.currentValues.set(param.name, integer ? parseInt(raw, 10) : parseFloat(raw));
      }
    });
    return input;
  }

  private renderBoolean(param: FormParameter, value: boolean): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = "param-boolean";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `param-${param.name}`;
    input.checked = Boolean(value);
    input.addEventListener("change", () => {
      this.currentValues.set(param.name, input.checked);
    });
    const slider = document.createElement("span");
    slider.className = "param-slider";
    wrapper.appendChild(input);
    wrapper.appendChild(slider);
    return wrapper;
  }

  private renderSelect(param: FormParameter, value: string): HTMLElement {
    const select = document.createElement("select");
    select.id = `param-${param.name}`;
    select.className = "param-input param-select";
    const options = param.options || [];
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (String(value) === opt.value) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener("change", () => {
      this.currentValues.set(param.name, select.value);
    });
    return select;
  }

  private renderFile(param: FormParameter, value: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "param-file-row";

    const input = document.createElement("input");
    input.type = "text";
    input.id = `param-${param.name}`;
    input.className = "param-input param-file-path";
    input.placeholder = "Path to file...";
    input.value = String(value ?? "");
    input.addEventListener("input", () => {
      this.currentValues.set(param.name, input.value);
    });

    const browseBtn = document.createElement("button");
    browseBtn.type = "button";
    browseBtn.className = "param-browse-btn";
    browseBtn.textContent = "Browse";
    browseBtn.addEventListener("click", async () => {
      // Use the existing directory picker — file picker can be added later
      const dir = await window.orbit.browseDirectory?.();
      if (dir) {
        input.value = dir;
        this.currentValues.set(param.name, dir);
      }
    });

    row.appendChild(input);
    row.appendChild(browseBtn);
    return row;
  }

  /** Returns the current parameter values as a plain object. */
  getValues(): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    this.currentValues.forEach((v, k) => { out[k] = v; });
    return out;
  }

  /** Disable/enable all form inputs (during execution). */
  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    const inputs = this.container.querySelectorAll("input, select, button");
    inputs.forEach((el) => {
      (el as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = disabled;
    });
  }

  clear(): void {
    this.container.innerHTML = "";
    this.currentValues.clear();
    this.spec = null;
  }

  hasSpec(): boolean {
    return this.spec !== null;
  }
}
