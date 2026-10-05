# agit — run git against a Cloudflare Artifacts repo with a cached, auto-renewed repo token.
# Load it from ~/.zshrc with: source /path/to/epoch/scripts/agit.zsh
#
#   agit push cloudflare main
#   agit fetch cloudflare
#   agit clone https://<account>.artifacts.cloudflare.net/git/epoch/epoch.git
#   agit --refresh push cloudflare main   # discard the cached token first (e.g. it was revoked)
#
# The repo is taken from AGIT_NAMESPACE/AGIT_REPO if both are set, else from the first
# artifacts.cloudflare.net URL among the arguments (clone), else from the remote named
# $AGIT_REMOTE (default: cloudflare) in the current repository.
#
# The token is cached under ${XDG_CACHE_HOME:-~/.cache}/agit/, one 0600 file per repo, and is
# renewed when it is within AGIT_MIN_TTL_SECONDS of the expiry encoded in its "?expires=" suffix.
# It reaches git only through the environment of that one git process, via a credential helper
# scoped to *.artifacts.cloudflare.net, so it never lands in argv, a remote URL, git config, or
# another credential store; other remotes keep their usual helpers.
#
# Settings (environment): AGIT_NAMESPACE, AGIT_REPO, AGIT_REMOTE=cloudflare,
# AGIT_SCOPE=write, AGIT_TTL_SECONDS=3600, AGIT_MIN_TTL_SECONDS=120, AGIT_CF="npx -y cf".

agit() {
	emulate -L zsh
	setopt pipe_fail no_unset
	zmodload -F zsh/datetime p:EPOCHSECONDS || return 1

	local is_refresh=0
	if [[ ${1:-} == --refresh ]]; then
		is_refresh=1
		shift
	fi
	if (( $# == 0 )); then
		print -u2 'usage: agit [--refresh] <git command> [args...]'
		return 2
	fi

	local remote=${AGIT_REMOTE:-cloudflare}
	local scope=${AGIT_SCOPE:-write}
	local ttl_seconds=${AGIT_TTL_SECONDS:-3600}
	local min_ttl_seconds=${AGIT_MIN_TTL_SECONDS:-120}
	local -a cf=(${(z)${AGIT_CF:-npx -y cf}})

	# Work out which namespace/repo the token is for.
	local namespace=${AGIT_NAMESPACE:-} repo=${AGIT_REPO:-} url='' arg
	if [[ -z $namespace || -z $repo ]]; then
		for arg in "$@"; do
			if [[ $arg == https://*.artifacts.cloudflare.net/git/*/* ]]; then
				url=$arg
				break
			fi
		done
		[[ -z $url ]] && url=$(command git remote get-url "$remote" 2>/dev/null)
		if [[ $url =~ '^https://[^/@]+\.artifacts\.cloudflare\.net/git/([^/]+)/([^/]+)$' ]]; then
			namespace=$match[1]
			repo=${match[2]%.git}
		else
			print -u2 "agit: no Artifacts repo found: pass its URL, add a '$remote' remote, or set AGIT_NAMESPACE and AGIT_REPO"
			return 2
		fi
	fi

	local cache_dir=${XDG_CACHE_HOME:-$HOME/.cache}/agit
	local cache_file=$cache_dir/$namespace--$repo.$scope.token
	# Matches art_v<N>_<secret>?expires=<unix seconds>; the suffix is the only expiry we get.
	# The version prefix is left open because it has already changed once (v1 → v2_x_).
	local token_pattern='^art_v[0-9]+_[A-Za-z0-9_]+\?expires=([0-9]+)$'
	local token=''

	if (( ! is_refresh )) && [[ -f $cache_file && ! -L $cache_file ]]; then
		token=$(<$cache_file)
		if [[ ! $token =~ $token_pattern ]] || (( match[1] - EPOCHSECONDS < min_ttl_seconds )); then
			token=''
		fi
	fi

	if [[ -z $token ]]; then
		if ! (( $+commands[jq] )); then
			print -u2 'agit: jq is required to read the new token'
			return 1
		fi
		token=$("${cf[@]}" -q artifacts namespaces tokens create "$namespace" \
			--repo "$repo" --scope "$scope" --ttl "$ttl_seconds" | jq -er '.plaintext')
		if (( $? != 0 )) || [[ ! $token =~ $token_pattern ]]; then
			print -u2 "agit: could not get a token for $namespace/$repo (logged in? try: ${cf[*]} auth whoami)"
			return 1
		fi

		# Write via a private temp file and rename, so a crash or a concurrent agit never
		# leaves a half-written or world-readable token behind.
		(umask 077 && mkdir -p -- $cache_dir) || return 1
		local tmp_file
		tmp_file=$(umask 077 && mktemp "$cache_dir/.token.XXXXXX") || return 1
		print -rn -- $token >| $tmp_file && command mv -f -- $tmp_file $cache_file || {
			command rm -f -- $tmp_file
			return 1
		}
	fi

	# The empty helper first clears any helper (osxkeychain, store, ...) that would otherwise
	# be handed the token on success and keep it; the scope keeps GitHub & co. untouched.
	AGIT_TOKEN=$token command git \
		-c 'credential.https://*.artifacts.cloudflare.net.helper=' \
		-c 'credential.https://*.artifacts.cloudflare.net.helper=!f() { test "$1" = get || exit 0; echo username=x; echo "password=$AGIT_TOKEN"; }; f' \
		"$@"
}
