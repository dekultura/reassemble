import * as React from "react";
import { assert } from "chai";
import { shallow } from "enzyme";

import assemble from "./assemble";
import getContext from "./getContext";
import Component from "../test/component";

describe("getContext", () => {
  it("should render with context added to props", () => {
    const composable = getContext<any>({
      themer: React.PropTypes.object,
      prefixer: React.PropTypes.object,
    });
    const context = {
      themer: {},
      prefixer: {},
    };
    const Assembly = assemble<any, any>(composable)(Component);
    const wrapper = shallow(<Assembly in1={3} />, { context });
    assert.deepEqual(wrapper.props(), {
      in1: 3,
      ...context,
    });
  });
});
