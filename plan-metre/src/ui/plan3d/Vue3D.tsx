// À RÉALISER (module « vue 3D »).
import type { Catalogue, Plan } from '../../model/types';

export interface ProprietesVue3D {
  plan: Plan;
  catalogue: Catalogue;
}

export function Vue3D(_props: ProprietesVue3D) {
  return <div className="vide">Vue 3D — à venir</div>;
}
