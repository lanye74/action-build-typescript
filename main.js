import {getInput, info, warning, setFailed} from "@actions/core";
import {getOctokit, context} from "@actions/github";
import {cp, } from "@actions/io";
import {exec} from "@actions/exec";
import {promises} from "fs";

import {join} from "path";

const {access} = promises;


// Inputs
const pushToBranch = getInput("pushToBranch");
const branchName = getInput("branch");
const githubToken = getInput("githubToken");
const directory = process.env.GITHUB_WORKSPACE;



if (pushToBranch == true && !githubToken) {
	return exit("A GitHub secret token is a required input for pushing code (hint: use ${{ secrets.GITHUB_TOKEN }} )");
}



(async () => {
	const tsconfigPath = join(directory, "tsconfig.json");

	try {
		await access(tsconfigPath);

		const tsconfig = require(tsconfigPath);
		const outDir = tsconfig.compilerOptions.outDir ?? directory;


		// Install tsc
		info("Installing Typescript");
		await exec("npm i --g typescript");

		// Build project
		info("Building project");

		const build = await exec(`tsc`, [], { cwd: directory });

		if (build !== 0) return exit("Something went wrong while building.");
		if (pushToBranch == "false") return process.exit(0);


		const octokit = getOctokit(githubToken);

		const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
		const branches = await octokit.repos.listBranches({
			owner,
			repo,
		});



		// Set up Git user
		info("Configuring Git user");
		await exec(`git config --global user.name actions-user`);
		await exec(`git config --global user.email action@github.com`);


		info("Cloning branch");
		const clone = await exec(
			`git clone https://${context.actor}:${githubToken}@github.com/${owner}/${repo}.git branch-${branchName}`
		);

		if (clone !== 0) {
			return exit("Something went wrong while cloning the repository.");
		}



		const branchExists = branches.data.some(branch => branch.name.toLowerCase() === branchName);

		// Check out to branch
		await exec(
			`${
				branchExists
					? `git checkout ${branchName}`
					: `git checkout --orphan ${branchName}`
			}`,
			[],
			{ cwd: `branch-${branchName}` }
		);

		// Copy compiled files and package* files
		info("Copying compiled files and package* files");
		await cp(join(directory, outDir), `branch-${branchName}`, {
			recursive: true,
		});

		info("Removing gitignore")
		await exec(`rm ${join(directory, ".gitignore")}`);


		info("Removing typescript files")
		const srcDirectory = tsconfig.compilerOptions.rootDir || "";

		if(srcDirectory !== "") {
			await exec(`rm ${join(directory, srcDirectory)}`);
		}


		// Commit files
		info("Adding and commiting files");
		await exec(`git add ."`, [], { cwd: `branch-${branchName}` });
		// We use the catch here because sometimes the code itself may not have changed
		await exec(`git commit -m "build: ${context.sha}"`, [], {
			cwd: `branch-${branchName}`,
		}).catch((_err) =>
			warning("Couldn't commit new changes because there aren't any")
		);

		// Push files
		info("Pushing new changes");
		await exec(`git push origin HEAD:${branchName}`, [], {
			cwd: `branch-${branchName}`,
		});

		process.exit(0);
	} catch (error) {
		exit(`Something went wrong: ${error}`);
	}
})();



function exit(error) {
	setFailed(error);
	process.exit();
}
