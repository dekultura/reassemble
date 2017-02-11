import * as React from "react";
import { ComponentClass, Component } from "react";

import { ReactComponent, ReactAnyComponent, ComponentEnhancer } from "./types";
import {
  createBlueprint, InstanceCallbackListTypesafe, StateUpdater, LifeCycleCallbackTypes,
  Blueprint, InstanceCallbackEntry, ComponentCallbacks,
} from "./blueprint";
import getDisplayName from "./utils/getDisplayName";
import getUniqueKey from "./utils/getUniqueKey";
import isReferentiallyTransparentFunctionComponent from "./utils/isReferentiallyTransparentFunctionComponent";

type ComponentData = {
  props: any,
  state: any,
  context: any,
  component: ReactAnyComponent,
  childContext?: any,
  lifeCycleCallbacks?: {[P in keyof LifeCycleCallbackTypes]: Function[]} & { [name: string]: Function[] },
};

type StateCallbackEntry = InstanceCallbackEntry<"stateCallback"> & {
  init?: ComponentData;
  called?: boolean;
  startAt?: number;
};

const hasWillReceivePropsCallback = (e: InstanceCallbackEntry<any>) => e.kind === "componentWillReceivePropsCallback";

class AssemblyBase<T> extends Component<T, any> {
  private target: ReactComponent<any> | string;
  private isReferentiallyTransparent: boolean;
  private callbackList: InstanceCallbackListTypesafe;
  private hasWillReceivePropsCallback: boolean;
  private computed: ComponentData;
  private newestProps: any;
  private newestContext: any;

  constructor(
    blueprint: Blueprint,
    target: ReactComponent<any> | string,
    isReferentiallyTransparent: boolean,
    props: any,
    context: any,
  ) {
    super(props, context);
    this.newestProps = props;
    this.newestContext = context;
    this.isReferentiallyTransparent = isReferentiallyTransparent;
    this.target = target;
    this.callbackList = blueprint.instanceCallbacks();
    this.hasWillReceivePropsCallback = this.callbackList.some(hasWillReceivePropsCallback);
    this.computed = this.runInstanceCallbacks({ props, state: {}, context, component: this.target });
    this.state = this.computed.state;
  }

  public getChildContext() { return this.computed.childContext; }
  public componentWillMount() { return this.runLifeCycleCallbacks("componentWillMountCallback"); }
  public componentDidMount() { return this.runLifeCycleCallbacks("componentDidMountCallback"); }
  public componentWillUnmount() { return this.runLifeCycleCallbacks("componentWillUnmountCallback"); }
  public componentWillUpdate() { return this.runLifeCycleCallbacks("componentWillUpdateCallback"); }
  public componentDidUpdate() { return this.runLifeCycleCallbacks("componentDidUpdateCallback"); }
  public componentWillReceiveProps(nextProps: any, nextContext: any) {
    this.newestProps = nextProps;
    this.newestContext = nextContext;
    this.rerunInstanceCallbacks({
      props: nextProps,
      state: this.computed.state,
      context: nextContext,
      component: this.target,
    });
    this.runLifeCycleCallbacks("componentWillReceivePropsCallback");
  }

  public shouldComponentUpdate(nextProps: any, nextState: any, nextContext: any) {
    if (!this.hasWillReceivePropsCallback) {
      // State based props was not computed before, do it now.
      this.rerunInstanceCallbacks({
        props: nextProps,
        state: nextState,
        context: nextContext,
        component: this.target,
      });
    }
    const callbacks = this.computed.lifeCycleCallbacks.shouldComponentUpdateCallback;
    if (callbacks) {
      for (let i = 0; i < callbacks.length; i++) {
        if (!callbacks[i]()) {
          return false;
        }
      }
    }
    return true;
  }

  public render() {
    const {component: Component, props} = this.computed;
    if (!Component) {
      return null;
    }
    if (
      Component === this.target && this.isReferentiallyTransparent ||
      isReferentiallyTransparentFunctionComponent(Component)
    ) {
      return (Component as any)(props);
    }
    return <Component {...props} />;
  }

  private runLifeCycleCallbacks(name: keyof LifeCycleCallbackTypes) {
    const callbacks = this.computed.lifeCycleCallbacks[name];
    if (callbacks) { callbacks.forEach((cb) => cb()); }
  }

  private setStateWithLifeCycle(stateDiff: any, callback: () => void, init: ComponentData, startAt: number) {
    if (this.hasWillReceivePropsCallback) {
      // State needs to be considered for componentWillReceiveProps, so
      // we process props on every state change.
      if (!init) {
        init = {
          props: this.newestProps,
          state: this.computed.state,
          context: this.newestContext,
          component: this.target,
        };
        startAt = 0;
      }
      this.rerunInstanceCallbacks({ ...init, state: { ...this.computed.state, ...stateDiff } }, startAt);
      this.runLifeCycleCallbacks("componentWillReceivePropsCallback");
    }
    this.setState(stateDiff, callback);
  }

  private rerunInstanceCallbacks(init: ComponentData, startAt = 0) {
    this.computed = this.runInstanceCallbacks(init, startAt);
    const hasNewlyInitializedState = this.computed.state !== init.state;
    if (hasNewlyInitializedState) {
      this.setState(this.computed.state);
      if (this.hasWillReceivePropsCallback) {
        this.runLifeCycleCallbacks("componentWillReceivePropsCallback");
      }
    }
  }

  private runInstanceCallbacks(init: ComponentData, startAt = 0): ComponentData {
    const interim = { ...init };
    if (!interim.lifeCycleCallbacks) { interim.lifeCycleCallbacks = {}; }
    for (let idx = startAt; idx < this.callbackList.length; idx++) {
      const entry = this.callbackList[idx];
      switch (entry.kind) {
        case "propsCallback":
          interim.props = entry.callback(interim.props, interim.state, interim.context);
          break;
        case "stateCallback":
          const sc = entry as StateCallbackEntry;
          if (this.hasWillReceivePropsCallback) {
            sc.init = { ...interim };
            sc.startAt = idx;
          }
          if (!sc.called) {
            sc.called = true;
            const initState = (name: string, value: any) => {
              let unique = getUniqueKey(name, interim.state);
              interim.state = { ...interim.state, [unique]: value };
              const updater: StateUpdater<any> = (val, callback) => {
                this.setStateWithLifeCycle({ [unique]: val }, callback, sc.init, sc.startAt);
              };
              return { name: unique, updater };
            };
            entry.callback(initState, interim.props, interim.state, interim.context);
          }
          break;
        case "childContextCallback":
          interim.childContext = entry.callback(interim.childContext, interim.props, interim.state, interim.context);
          break;
        case "skipCallback":
          idx += entry.callback(interim.props, interim.state, interim.context);
          break;
        case "renderCallback":
          interim.component = entry.callback(interim.component, interim.props, interim.state, interim.context);
          break;
        case "lazyLoadCallback":
          const list = entry.callback(interim.props, interim.state, interim.context);
          if (list && list.length > 0) {
            this.callbackList = [...this.callbackList.slice(0, idx + 1), ...list, ...this.callbackList.slice(idx + 1)];
            if (!this.hasWillReceivePropsCallback) {
              this.hasWillReceivePropsCallback = list.some(hasWillReceivePropsCallback);
            }
          }
          break;
        case "componentWillReceivePropsCallback":
        case "componentWillMountCallback":
        case "componentDidMountCallback":
        case "componentWillUnmountCallback":
        case "shouldComponentUpdateCallback":
        case "componentWillUpdateCallback":
        case "componentDidUpdateCallback":
          const hasCallbacks = interim.lifeCycleCallbacks[entry.kind] !== undefined;
          const callback = entry.callback(interim.props, interim.state, interim.context);
          interim.lifeCycleCallbacks = {
            ...interim.lifeCycleCallbacks,
            [entry.kind]: hasCallbacks
              ? [...interim.lifeCycleCallbacks[entry.kind], callback]
              : [callback],
          };
          break;
        default:
          throw new Error(`Unknown callback entry '${(entry as any).kind}'`);
      }
    }
    return interim;
  }
}

export function assemble(...callbacks: ComponentCallbacks[]): ComponentEnhancer<any, any>;
export function assemble<TInner, TOuter>(...callbacks: ComponentCallbacks[]): ComponentEnhancer<TInner, TOuter>;
export function assemble<TInner, TOuter>(...callbacks: ComponentCallbacks[]): ComponentEnhancer<TInner, TOuter> {
  const blueprint = createBlueprint(...callbacks);
  return (target: ReactComponent<TInner>) => {
    const isReferentiallyTransparent = isReferentiallyTransparentFunctionComponent(target);
    const targetName = getDisplayName(target);
    const assembled: ComponentClass<TOuter> = class extends AssemblyBase<TOuter> {
      public static displayName = isReferentiallyTransparent
        ? targetName
        : `Assembled(${targetName})`;

      constructor(props: any, context: any) {
        super(blueprint, target, isReferentiallyTransparent, props, context);
      }
    };
    blueprint.staticCallbacks.forEach((cb) => cb(assembled, target));
    return assembled;
  };
}

export default assemble;
