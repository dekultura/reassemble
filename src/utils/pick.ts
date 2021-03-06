export function pick<T extends {}, K extends keyof T>(obj: T, ...keys: K[]): Pick<T, K>;
export function pick<T extends {}>(obj: T, ...keys: Array<keyof T | symbol>):
  { [name: string]: any };

export function pick(obj: any, ...keys: Array<string | symbol>): any {
  const result: any = {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (obj.hasOwnProperty(key)) {
      result[key] = obj[key];
    }
  }
  return result;
};

export default pick;
