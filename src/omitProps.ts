import mapProps from "./mapProps";
import omit from "./utils/omit";

export function omitProps<T extends string | symbol>(...propNames: T[]) {
  return mapProps((props) => omit(props, ...propNames));
}

export default omitProps;
