type StepFn = () => void | Promise<void>;

const step = (keyword: string) => async (desc: string, fn: StepFn) => {
  // console.log(`  ${keyword.padEnd(5)} ${desc}`);
  try {
    await fn();
  } catch (e) {
    if (e instanceof Error) e.message = `${keyword} ${desc}\n${e.message}`;
    throw e;
  }
};

export const given = step("Given");
export const when = step("When");
export const then = step("Then");
export const and = step("And");
