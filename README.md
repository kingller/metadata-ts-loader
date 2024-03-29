# metadata-ts-loader
A Webpack loader for extracting typescript metadata (interface, comments jsDoclets, etc) defined in TypeScript. 
Helpful for get documentation information from typescript, it parse and return JSON metadata when requiring a file.

## Installation

```sh
$ npm install --save metadata-ts-loader
```

## Usage

Generally you will want to use the inline request syntax for using this loader,
instead of adding it to your config file.

```js
var metadata = require('metadata-ts-loader!./some/my-component');

metadata.metadataDocs[0] // { props, description, displayName }
```

If you want to get an object mapped with displayName instead of array, you can set `mapping=true` as bellow
```js
var metadata = require('metadata-ts-loader?mapping=true!./some/my-component');

metadata // { [displayName]: { props, description, displayName } }
```

### Instruction

The loader will parse out any jsDoc style from typescript comment blocks. You can
access them from `metadata.metadataDocs[0].props`

- `@default`: for manually specifying a default value for a prop.

### Exporting

**It is important** to export your module using a named export for docgen information to be generated properly.

---

`interface.ts`:

```typescript
/**
 * Button properties.
 */
// Notice the named export here, this is required for docgen information
// to be generated correctly.
export interface IButtonProps {
  /**
   * Value to display, either empty (" ") or "X" / "O".
   *
   * @default " "
   **/
  value?: " " | "X" | "O";

  /** Cell position on game board. */
  position: { x: number, y: number };

  /** Called when an empty cell is clicked. */
  onClick?: (x: number, y: number) => void;
}
```

Will generate the following outpout: 
```json
{
  "metadataDocs": [{
    "description": "Button properties.",
    "displayName": "IButtonProps",
    "methods": [],
    "props": {
      "value": {
        "defaultValue": {
          "value": "\" \""
        },
        "description": "Value to display, either empty (\" \") or \"X\" / \"O\".",
        "name": "value",
        "required": false,
        "type": {
          "name": "\" \" | \"X\" | \"O\""
        }
      },
      "position": {
        "defaultValue": null,
        "description": "Cell position on game board.",
        "name": "position",
        "required": true,
        "type": {
          "name": "{ x: number; y: number; }"
        }
      },
      "onClick": {
        "defaultValue": null,
        "description": "Called when an empty cell is clicked.",
        "name": "onClick",
        "required": false,
        "type": {
          "name": "(x: number, y: number) => void"
        }
      }
    }
  }]
}
```

### Export Names

Typescript docgen information can not be
generated for module that are only exported as default. You can work around
the issue by exporting the module using a named export.

```typescript
/**
 * TicTacToe game cell. Displays a modal when the visible is true,
 * otherwise hide.
 */
// Notice the named export here, this is required for docgen information
// to be generated correctly.
export class TicTacToeCell {
  /** modal visibility */
  visible = false;

  /** Click to change visibility */
  handleClick = () => {
      this.visible = !this.visible;
  };
}

// TicTacToeCell can still be exported as default.
export default TicTacToeCell;
```

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests as appropriate.
