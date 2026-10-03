# Agent de tri Outlook

Un petit programme qui lit les mails de votre boîte de réception Outlook (Microsoft 365), demande à une IA de les classer, puis les range dans des dossiers, leur donne une catégorie de couleur et signale les urgences. Il produit aussi un résumé de ce qui demande votre attention.

Il **ne supprime jamais** un mail, **n'envoie jamais** de message et **ne marque rien comme lu**. Par défaut il fonctionne en **simulation** : il montre ce qu'il ferait sans rien modifier.

## Comment il classe

| Dossier (créé sous la Boîte de réception) | Catégorie Outlook | Contenu |
|---|---|---|
| Chantier en cours | Chantier | comptes rendus, planning, réserves, aléas, échanges avec le maître d'ouvrage |
| Fournisseurs et sous-traitants | Fournisseurs | commandes, livraisons, relances, documents de sous-traitance |
| Devis et factures | Devis-Factures | devis, factures, situations, acomptes, relances de paiement |
| MOE - BET - Contrôle | MOE-BET-Contrôle | architecte, maître d'œuvre, bureaux d'études, bureau de contrôle, plans |
| Sécurité et réglementaire | Sécurité | PPSPS, coordinateur SPS, accidents, habilitations, normes |
| Administratif | Administratif | RH, assurances, contrats, vie de l'entreprise |
| Newsletters et pubs | Newsletter | publicités, prospection, notifications sans action |
| **À traiter urgent** | Urgent | tout mail qui exige une réaction sous 24 à 48 h, quel que soit le sujet |

Règles complémentaires :

- Un mail urgent est rangé dans « À traiter urgent », reçoit un drapeau rouge, et garde sa catégorie de sujet.
- Un mail où une action est attendue de votre part reçoit en plus la catégorie « Action requise ».
- **Dans le doute, l'agent ne range pas** : sous le seuil de confiance (0,6 par défaut) le mail reste dans la boîte de réception avec la catégorie « À vérifier ».
- Les invitations et réponses de réunion ne sont pas touchées.
- Un mail déjà traité n'est jamais analysé deux fois. Un mail qui échoue sans cesse (illisible, refusé par l'IA) est laissé de côté après 3 échecs sur au moins 24 h, en boîte de réception avec la catégorie « À vérifier ». Une panne passagère ne suffit donc pas à faire abandonner un mail.
- L'agent ne retire jamais une catégorie que vous avez posée vous-même.

## Mise en place

### 1. Choisir le fournisseur d'IA

L'agent fonctionne avec tout service compatible avec l'API OpenAI. Il se règle par trois lignes du fichier `.env` : `OPENAI_BASE_URL`, `OPENAI_API_KEY` et `OPENAI_MODEL`. Plusieurs options sont gratuites.

Situation au 3 octobre 2026, d'après une recherche contre-vérifiée. Les offres gratuites changent souvent : vérifiez les conditions au moment de vous inscrire.

**Dans tous les cas**, vos mails contiennent des données de clients et de fournisseurs. Pour un service en ligne, faites valider le choix par votre employeur (DSI ou délégué à la protection des données), et ouvrez le compte au nom de l'entreprise.

| Option | Coût | Vos mails | Pour qui |
|---|---|---|---|
| **A. Modèle local (Ollama)** | gratuit, sans limite | ne quittent pas le PC | le plus sûr ; il faut un PC correct et l'accord de la DSI pour installer |
| **B. Mistral AI** (français) | gratuit (crédit mensuel inclus) | pas d'entraînement **si vous le désactivez d'abord** | bon compromis, entreprise européenne |
| **C. Google Gemini** | gratuit, mais clause à faire valider (sinon ~1 $ par mois) | depuis la France, pas d'entraînement ; peuvent être traités hors UE | quotas gratuits confortables |
| **D. Groq** | gratuit | pas d'entraînement ; traités hors UE | rapide, quotas serrés par minute |
| OpenAI (API payante) | ~1 € par mois | pas d'entraînement par défaut | si l'entreprise a déjà un compte |

**À éviter pour des mails professionnels :**
- les modèles « :free » d'OpenRouter : certains fournisseurs peuvent entraîner leurs modèles sur vos messages, et l'offre est limitée à 50 requêtes par jour ;
- GitHub Models, qui est fermé depuis le 30/07/2026 ;
- Cerebras, qui n'a plus d'offre gratuite permanente ;
- les outils non officiels qui pilotent chatgpt.com.

#### A. Modèle local avec Ollama (recommandé pour la confidentialité)

1. Avec l'accord de la DSI, installez Ollama (<https://ollama.com>, version stable). Dans ses paramètres, laissez désactivés « Expose Ollama to the network » et « Allow browser ».
2. Ajoutez la variable d'environnement Windows `OLLAMA_NO_CLOUD=1`, qui coupe les fonctions en ligne d'Ollama, puis redémarrez Ollama.
3. Téléchargez un modèle : `ollama pull ministral-3:3b`. Il pèse environ 3 Go, est fait par Mistral AI et sous licence libre. Avec 16 Go de RAM ou une carte graphique, `ministral-3:8b` classe mieux.
4. Dans `.env` :
   ```
   OPENAI_BASE_URL=http://localhost:11434/v1
   OPENAI_MODEL=ministral-3:3b
   ```
   Aucune clé n'est nécessaire. L'agent applique de lui-même les bons réglages locaux : température 0 (sans elle, les réponses sont aléatoires), 512 jetons au plus par réponse, et aucun passage par le proxy de l'entreprise.

Comptez environ 10 à 25 secondes par mail sans carte graphique dédiée (estimation à mesurer sur votre PC), soit une à deux minutes par passage. Les cartes graphiques intégrées ne sont pas utilisées par défaut. Ne montez pas `OUTLOOK_BODY_CHARS` au-delà de 3500 : la mémoire de travail du modèle est de 4096 jetons par défaut, et au-delà Ollama couperait le début, c'est-à-dire les consignes, sans le signaler. Un mail rempli de liens compte vite beaucoup de jetons. Pour aller plus loin, ajoutez la variable `OLLAMA_CONTEXT_LENGTH=8192` et vérifiez la colonne CONTEXT de `ollama ps`. N'activez jamais `OLLAMA_DEBUG_LOG_REQUESTS`, qui écrirait le contenu des mails sur le disque.

#### B. Mistral AI

1. Créez un compte sur <https://console.mistral.ai>, au nom de l'entreprise (l'API est réservée aux clients professionnels). Pas de carte bancaire : le mode gratuit inclut un crédit mensuel, d'environ 10 $ d'après la recherche, à vérifier. 80 mails par jour en consomment environ 0,35 $ par mois.
2. **Avant le premier vrai mail**, désactivez l'utilisation de vos données pour l'entraînement : <https://admin.mistral.ai> → Privacy → « Anonymous improvement data », côté API. En mode gratuit, elle est active par défaut, et la désactivation ne vaut que pour la suite. N'utilisez pas de modèle `labs-*` et ne donnez pas d'avis (pouce) sur des réponses : ces deux cas restent utilisés pour l'entraînement.
3. Créez une clé API, puis dans `.env` :
   ```
   OPENAI_BASE_URL=https://api.mistral.ai/v1
   OPENAI_API_KEY=<votre clé Mistral>
   OPENAI_MODEL=ministral-8b-latest
   OUTLOOK_LLM_TEMPERATURE=0
   OUTLOOK_LLM_PAUSE=2
   OPENAI_MAX_RETRIES=5
   ```
   Pour garantir un traitement dans l'UE, utilisez `https://api.eu.mistral.ai/v1`, environ 10 % plus cher. Si vous prenez `mistral-small-latest`, ajoutez `OUTLOOK_LLM_REASONING_EFFORT=none`.

#### C. Google Gemini (Google AI Studio)

1. Créez une clé sur <https://aistudio.google.com> sans lier de compte de facturation : c'est l'offre gratuite. Ne collez pas de vrais mails dans l'interface d'AI Studio et n'y donnez pas d'avis : ces contenus-là sont conservés.
2. Dans `.env` :
   ```
   OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
   OPENAI_API_KEY=<votre clé AI Studio>
   OPENAI_MODEL=gemini-3.1-flash-lite
   OUTLOOK_LLM_PAUSE=5
   OPENAI_MAX_RETRIES=5
   ```
3. Consultez vos quotas réels sur <https://aistudio.google.com/rate-limit>. Pour un modèle Flash-Lite, on rapporte environ 15 requêtes par minute et 500 par jour.

À savoir :
- **Pas d'entraînement depuis l'Europe.** Les conditions de Google appliquent à l'offre gratuite, pour les utilisateurs en Europe (EEE), les règles de données de l'offre payante : vos mails ne servent pas à entraîner les modèles. L'agent doit tourner depuis la France.
- **Ce qui reste conservé.** Google garde les requêtes environ 55 jours pour détecter les abus, et elles peuvent être traitées hors UE.
- **Clause à faire valider avant usage.** Ces mêmes conditions imposent l'offre payante pour tout outil mis à disposition d'utilisateurs en Europe : l'offre gratuite pourrait donc ne pas être autorisée pour votre usage. Faites trancher la question par votre employeur. L'offre payante coûte environ 1 $ par mois pour ce volume, avec un prépaiement minimum de 5 $.

#### D. Groq

1. Créez une clé sur <https://console.groq.com>, sans carte. Le contrat exclut l'entraînement sur vos données. Les requêtes peuvent être journalisées jusqu'à 30 jours ; activez « Zero Data Retention » dans Settings → Data Controls si votre compte le propose. Le lieu de traitement n'est pas garanti (États-Unis, Canada, Arabie saoudite ou Finlande) et les données conservées le sont aux États-Unis.
2. Dans `.env` :
   ```
   OPENAI_BASE_URL=https://api.groq.com/openai/v1
   OPENAI_API_KEY=gsk_...
   OPENAI_MODEL=openai/gpt-oss-20b
   OUTLOOK_LLM_REASONING_EFFORT=low
   OUTLOOK_LLM_MAX_TOKENS=1024
   OUTLOOK_LLM_PAUSE=15
   ```
   Le plafond de 1024 jetons est indispensable : Groq décompte la longueur maximale demandée dans sa limite de 8000 jetons par minute.

#### OpenAI (API payante)

Ouvrez un compte sur <https://platform.openai.com> (distinct de l'abonnement ChatGPT), créez une clé et fixez une limite de dépense mensuelle. Seule la clé est à renseigner dans `.env` (`OPENAI_API_KEY`) ; le modèle par défaut est `gpt-4o-mini`.

**Bon à savoir, quel que soit le fournisseur :**
- **Format de réponse refusé.** Si le fournisseur n'accepte pas le format structuré, l'agent se replie de lui-même sur un format plus simple et l'indique en fin de passage.
- **Limite gratuite atteinte.** Quand la limite par minute ou par jour est atteinte, le passage s'arrête proprement et reprend au suivant, sans pénaliser les mails. Si cela se répète, augmentez `OUTLOOK_LLM_PAUSE`.

### 2. Application Microsoft (Entra ID)

Sur <https://entra.microsoft.com> :

1. **Applications → Inscriptions d'applications → Nouvelle inscription**.
   - Nom : `Agent Outlook`.
   - Types de comptes : *Comptes dans cet annuaire d'organisation uniquement*.
   - URI de redirection : laisser vide.
2. Dans l'application créée : **Authentification → Paramètres avancés → Autoriser les flux clients publics : Oui**. Enregistrer.
3. **Autorisations d'API → Ajouter une autorisation → Microsoft Graph → Autorisations déléguées** : cocher `Mail.ReadWrite`.
   - Facultatif : `MailboxSettings.ReadWrite`, uniquement pour que la commande `setup` crée aussi les catégories de couleur. Si vous l'ajoutez, mettez `OUTLOOK_SCOPES=Mail.ReadWrite MailboxSettings.ReadWrite` dans `.env`.
   - Si le bouton **Accorder le consentement administrateur** est nécessaire dans votre organisation, il faut l'administrateur.
4. Dans **Vue d'ensemble**, copier l'*ID d'application (client)* et l'*ID de l'annuaire (locataire)*.

L'autorisation est « déléguée » : l'agent agit en votre nom, uniquement sur votre boîte. `Mail.ReadWrite` ne permet pas d'envoyer de mail, et cette permission n'est pas demandée.

### 3. Installation

Il faut Python 3.10 ou plus. Depuis le dossier `agent-outlook` :

```
python -m venv .venv
.venv\Scripts\activate            # Windows   (Mac/Linux : source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env            # Windows   (Mac/Linux : cp .env.example .env)
```

Ouvrir `.env` et renseigner `OUTLOOK_CLIENT_ID`, `OUTLOOK_TENANT_ID` et les lignes du fournisseur d'IA choisi à l'étape 1.

### 4. Premier lancement

```
python -m outlook_agent login            # connexion Microsoft : suivre le message (code à saisir sur une page web)
python -m outlook_agent setup            # crée les dossiers dans Outlook (et les couleurs si la permission est donnée)
python -m outlook_agent run --limit 20   # SIMULATION sur les 20 derniers mails
```

Lisez le résultat : pour chaque mail, le dossier prévu, puis un résumé (urgents, actions à mener, répartition). Si le classement vous convient :

```
python -m outlook_agent run --apply
```

Les résumés sont enregistrés dans `~/.outlook_agent/` : `dernier_resume.md` pour le dernier passage qui a traité des mails, `resumes/AAAA-MM-JJ.md` pour l'historique de la journée, `simulation.md` pour la dernière simulation. Un passage sans nouveau mail n'écrase rien.

Si quelque chose ne va pas, **annulez le dernier passage**. Les mails reviennent dans la boîte de réception, et l'agent retire les catégories et le drapeau qu'il avait posés, sans toucher à ceux que vous avez ajoutés depuis. Un mail que vous avez déplacé ou supprimé entre-temps reste où il est :

```
python -m outlook_agent undo            # simulation
python -m outlook_agent undo --apply
```

Les mails annulés ne sont pas ré-analysés ensuite. Pour les reclasser après avoir modifié les réglages : `run --reprocess --apply`.

### 5. Automatiser

Le plus simple est une tâche planifiée sur votre PC (il doit être allumé). Windows, toutes les 15 minutes :

```
schtasks /Create /SC MINUTE /MO 15 /TN "Agent Outlook" /TR "cmd /c cd /d C:\chemin\vers\agent-outlook && .venv\Scripts\python.exe -m outlook_agent run --apply"
```

Mac/Linux (cron) :

```
*/15 * * * * cd ~/agent-outlook && .venv/bin/python -m outlook_agent run --apply
```

L'agent retient où il en est : après un passage complet, il ne relit que les mails arrivés depuis, avec une marge d'un jour et d'après l'heure du serveur Microsoft. Un PC éteint tout un week-end ne fait donc rien manquer. Une fois par jour, il relit toute la boîte, pour rattraper un mail revenu avec une date ancienne (sorti des indésirables, par exemple). Un mail que vous déplacez ou supprimez pendant un passage n'est pas touché. Les 50 mails par passage (`--limit`) sont un plafond : s'il y en a plus, le reste est traité aux passages suivants.

Une tâche planifiée ne se reconnecte jamais seule : si Microsoft demande une nouvelle connexion (jeton expiré, politique de sécurité), elle s'arrête avec un message ; relancez `login`. De même, si la clé du fournisseur d'IA est refusée, la limite gratuite atteinte ou le réseau coupé, le passage s'arrête dès la première erreur, avec un message clair. Deux passages ne peuvent pas tourner en même temps : si la tâche planifiée tourne déjà, un lancement manuel l'indique et s'arrête.

## Personnaliser

- **Dossiers, catégories, consignes données à l'IA** : le fichier `outlook_agent/config.py`. Ajouter une ligne `Category(...)` suffit ; relancer `setup` pour créer le dossier.
- **Contexte métier** : variable `OUTLOOK_AGENT_CONTEXT` dans `.env` pour décrire votre activité en une ou deux phrases.
- **Prudence** : `OUTLOOK_MIN_CONFIDENCE` (0,6 par défaut) ou l'option `--min-confidence`. Plus le seuil est haut, plus de mails restent dans la boîte de réception.
- **Fournisseur et modèle** : voir l'étape 1. Les réglages avancés (`OUTLOOK_LLM_TEMPERATURE`, `OUTLOOK_LLM_MAX_TOKENS`, `OUTLOOK_LLM_REASONING_EFFORT`, `OUTLOOK_JSON_MODE`) sont décrits dans `.env.example`.

## Sécurité et confidentialité

- **Le contenu des mails est envoyé au fournisseur d'IA choisi**, sauf avec un modèle local : l'expéditeur, l'objet, la date et les premiers caractères du corps (1200 par défaut, réglable avec `OUTLOOK_BODY_CHARS`). Les pièces jointes ne sont pas envoyées. Vérifiez la politique de votre société sur l'usage de l'IA avant de brancher une boîte professionnelle, et les conditions du fournisseur sur les données transmises (voir l'étape 1).
- Un mail piégé qui contient des instructions n'a pas de prise : l'IA ne peut répondre que par un choix dans la liste des catégories, et le programme ne fait rien d'autre que ranger.
- Le jeton de connexion, l'historique des actions (objets et expéditeurs des mails rangés) et l'état sont gardés dans `~/.outlook_agent/` (réglable avec `OUTLOOK_AGENT_HOME`), hors du dépôt. Le fichier `.env` contient la clé du fournisseur d'IA : il est ignoré par git, ne le partagez pas.
- Sur une offre payante, fixez une limite de dépense.

## Dépannage

| Message | Cause probable |
|---|---|
| `AADSTS7000218` | « Autoriser les flux clients publics » n'est pas sur *Oui* (étape 2.2) |
| `AADSTS65001` | consentement non accordé : l'administrateur doit cliquer sur « Accorder le consentement administrateur » |
| `403` / `ErrorAccessDenied` de Graph | permission manquante dans l'application |
| `MailboxNotEnabledForRESTAPI` | boîte hébergée sur un Exchange interne : Microsoft Graph ne fonctionne qu'avec Exchange Online |
| `Connexion Microsoft requise` | relancer `python -m outlook_agent login` |
| `Connexion au fournisseur d'IA impossible` | réseau coupé ou, en local, Ollama n'est pas démarré |
| `Limite de requêtes atteinte` | limite de l'offre gratuite : le tri reprend au passage suivant ; augmentez `OUTLOOK_LLM_PAUSE` |
| `requête trop grosse pour la limite du fournisseur (413)` | une seule requête dépasse la limite par minute (Groq) : vérifiez `OUTLOOK_LLM_MAX_TOKENS=1024` et baissez `OUTLOOK_BODY_CHARS` |
| `réponse coupée par la limite de jetons` | le modèle manque de place pour répondre : augmentez `OUTLOOK_LLM_MAX_TOKENS` |
| `Crédit épuisé` ou `quota épuisé` | rechargez le compte du fournisseur, ou attendez le renouvellement du quota |
| `Modèle … introuvable` | nom de modèle erroné pour ce fournisseur (`OPENAI_MODEL`) |

## Tests

```
pip install -r requirements-dev.txt
python -m pytest
```

Les tests utilisent une boîte mail et un fournisseur d'IA simulés : ils ne contactent ni Microsoft ni aucun service d'IA.
